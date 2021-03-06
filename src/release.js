#!/usr/bin/env node
/* globals cat, config, cp, ls, popd, pushd, pwd, rm, exec, exit, which */
/* eslint curly: 0 */
import 'colors';
import 'shelljs/global';
import path from 'path';
import semver from 'semver';
import yargs from 'yargs';
import request from 'request';

// do not die on errors
config.fatal = false;

//------------------------------------------------------------------------------
// constants
const repoRoot = pwd();
const packagePath = path.join(repoRoot, 'package.json');
const changelog = path.join(repoRoot, 'CHANGELOG.md');

const npmjson = JSON.parse(cat(packagePath));
const isPrivate = npmjson.private;
const devDepsNode = npmjson.devDependencies;

//------------------------------------------------------------------------------
// check if one of 'rf-changelog' or 'mt-changelog' is used by project
const isCommitsChangelogUsed = devDepsNode &&
  devDepsNode['rf-changelog'] || devDepsNode['mt-changelog'];
if (isCommitsChangelogUsed && !which('changelog')) {
  printErrorAndExit('The "[rf|mt]-changelog" package is present in "devDependencies", but it is not installed.');
}

//------------------------------------------------------------------------------
// options
const configOptions = npmjson['release-script'] || {};
const bowerRoot = path.join(repoRoot, (configOptions.bowerRoot || 'amd/'));
const tmpBowerRepo = path.join(repoRoot, (configOptions.tmpBowerRepo || 'tmp-bower-repo'));
const bowerRepo = configOptions.bowerRepo; // if it is not set, then there is no bower repo

const githubToken = process.env.GITHUB_TOKEN;


//------------------------------------------------------------------------------
// command line options
const yargsConf = yargs
  .usage('Usage: $0 <version> [--preid <identifier>]')
  .example('$0 minor --preid beta', 'Release with minor version bump with pre-release tag')
  .example('$0 major', 'Release with major version bump')
  .example('$0 major --notes "This is new cool version"', 'Add a custom message to release')
  .example('$0 major --dry-run', 'Release dry run with patch version bump')
  .example('$0 --preid beta', 'Release same version with pre-release bump')
  .command('patch', 'Release patch')
  .command('minor', 'Release minor')
  .command('major', 'Release major')
  .command('<version>', 'Release specific version')
  .option('preid', {
    demand: false,
    describe: 'pre-release identifier',
    type: 'string'
  })
  .option('dry-run', {
    alias: 'n',
    demand: false,
    default: false,
    describe: 'Execute command in dry run mode. Will not commit, tag, push, or publish anything. Userful for testing.'
  })
  .option('verbose', {
    demand: false,
    default: false,
    describe: 'Increased debug output'
  })
  .option('notes', {
    demand: false,
    default: false,
    describe: 'A custom message for release. Overrides [rf|mt]changelog message'
  });

const argv = yargsConf.argv;

if (argv.dryRun) console.log('DRY RUN'.magenta);

config.silent = !argv.verbose;

const versionBumpOptions = {
  type: argv._[0],
  preid: argv.preid
};

if (versionBumpOptions.type === undefined && versionBumpOptions.preid === undefined) {
  console.log('Must provide either a version bump type, preid (or both)'.red);
  console.log(yargsConf.help());
  exit(1);
}

let notesForRelease = argv.notes;


//------------------------------------------------------------------------------
// functions
function printErrorAndExit(error) {
  console.error(error.red);
  exit(1);
}

function run(command) {
  const { code, output } = exec(command);
  if (code !== 0) printErrorAndExit(output);
  return output;
}

function safeRun(command) {
  if (argv.dryRun) {
    console.log(`[${command}]`.grey, 'DRY RUN'.magenta);
  } else {
    return run(command);
  }
}

/**
 * Npm's `package.json` 'repository.url' could be set to one of three forms:
 * git@github.com:<author>/<repo-name>.git
 * git+https://github.com/<author>/<repo-name>.git
 * or just <author>/<repo-name>
 * @returns [<author>, <repo-name>] array
 */
function getOwnerAndRepo(url) {
  let match = url.match(/^git@github\.com:(.*)\.git$/);
  match = match || url.match(/^git\+https:\/\/github\.com\/(.*)\.git$/);
  let gitUrlBase = match && match[1];
  return (gitUrlBase || url).split('/');
}

function release({ type, preid }) {
  if (type === undefined && !preid) printErrorAndExit('Must specify version type or preid');

  // ensure git repo has no pending changes
  if (exec('git diff-index --name-only HEAD --').output.length) {
    printErrorAndExit('Git repository must be clean');
  }
  console.info('No pending changes'.cyan);

  // ensure git repo last version is fetched
  if (/\[behind (.*)\]/.test(exec('git fetch').output)) {
    printErrorAndExit(`Your repo is behind by ${RegExp.$1} commits`);
  }
  console.info('Current with latest changes from remote'.cyan);

  // check linting and tests
  console.log('Running: '.cyan + 'linting and tests'.green);
  run('npm run test');
  console.log('Completed: '.cyan + 'linting and tests'.green);

  // version bump
  const oldVersion = npmjson.version;
  let newVersion;

  if (type === undefined) {
    newVersion = oldVersion; // --preid
  } else if (['major', 'minor', 'patch'].indexOf(type) >= 0) {
    newVersion = semver.inc(oldVersion, type);
  } else {
    newVersion = type; // '<version>', 'Release specific version'
  }

  if (preid) {
    newVersion = semver.inc(newVersion, 'pre', preid);
  }

  npmjson.version = newVersion;
  `${JSON.stringify(npmjson, null, 2)}\n`.to(packagePath);

  console.log('Version changed from '.cyan + oldVersion.green + ' to '.cyan + newVersion.green);
  safeRun('git add package.json');

  // npm run build
  if (npmjson.scripts.build) {
    console.log('Running: '.cyan + 'build'.green);
    const res = exec('npm run build');
    if (res.code !== 0) {
      // if error, then revert and exit
      console.log('Build failed, reverting version bump'.red);
      run('git reset HEAD .');
      run('git checkout package.json');
      console.log('Version bump reverted'.red);
      printErrorAndExit(res.output);
    }
    console.log('Completed: '.cyan + 'build'.green);
  } else {
    console.log('There is no "build" script in package.json. Skipping this step.'.yellow);
  }

  const vVersion = `v${newVersion}`;
  const versionAndNotes = notesForRelease = notesForRelease ? `${vVersion} ${notesForRelease}` : vVersion;

  // generate changelog
  if (isCommitsChangelogUsed) {
    run(`changelog --title="${versionAndNotes}" --out ${changelog}`);
    safeRun(`git add ${changelog}`);
    console.log('Generated Changelog'.cyan);
  }

  safeRun(`git commit -m "Release ${vVersion}"`);

  // tag and release
  console.log('Tagging: '.cyan + vVersion.green);
  if (isCommitsChangelogUsed) {
    notesForRelease = run(`changelog --title="${versionAndNotes}" -s`);
    safeRun(`changelog --title="${versionAndNotes}" -s | git tag -a -F - ${vVersion}`);
  } else {
    safeRun(`git tag -a --message="${versionAndNotes}" ${vVersion}`);
  }
  safeRun('git push');
  safeRun('git push --tags');
  console.log('Tagged: '.cyan + vVersion.green);

  // publish to GitHub
  if (githubToken) {
    console.log(`GitHub token found ${githubToken}`.green);
    console.log('Publishing to GitHub: '.cyan + vVersion.green);

    if (argv.dryRun) {
      console.log(`[publishing to GitHub]`.grey, 'DRY RUN'.magenta);
    } else {
      const [githubOwner, githubRepo] = getOwnerAndRepo(npmjson.repository.url || npmjson.repository);

      request({
        uri: `https://api.github.com/repos/${githubOwner}/${githubRepo}/releases`,
        method: 'POST',
        json: true,
        body: {
          tag_name: vVersion, // eslint-disable-line camelcase
          name: `${githubRepo} ${vVersion}`,
          body: notesForRelease,
          draft: false,
          prerelease: !!preid
        },
        headers: {
          'Authorization': `token ${githubToken}`,
          'User-Agent': 'release-script (https://github.com/alexkval/release-script)'
        }
      }, function (err, res, body) {
        if (err) {
          console.log('API request to GitHub, error has occured:'.red);
          console.log(err);
          console.log('Skip GitHub releasing'.yellow);
        } else if (res.statusMessage === 'Unauthorized') {
          console.log(`GitHub token ${githubToken} is wrong`.red);
          console.log('Skip GitHub releasing'.yellow);
        } else {
          console.log(`Published at ${body.html_url}`.green);
        }
      });
    }
  }

  // npm
  if (isPrivate) {
    console.log('Package is private, skipping npm release'.yellow);
  } else {
    console.log('Releasing: '.cyan + 'npm package'.green);
    safeRun('npm publish');
    console.log('Released: '.cyan + 'npm package'.green);
  }

  // bower
  if (isPrivate) {
    console.log('Package is private, skipping bower release'.yellow);
  } else if (bowerRepo) {
    console.log('Releasing: '.cyan + 'bower package'.green);
    rm('-rf', tmpBowerRepo);
    run(`git clone ${bowerRepo} ${tmpBowerRepo}`);
    pushd(tmpBowerRepo);
    rm('-rf', ls(tmpBowerRepo).filter(file => file !== '.git')); // delete all but `.git` dir
    cp('-R', bowerRoot, tmpBowerRepo);
    safeRun('git add -A .');
    safeRun(`git commit -m "Release ${vVersion}"`);
    safeRun(`git tag -a --message=${vVersion} ${vVersion}`);
    safeRun('git push');
    safeRun('git push --tags');
    popd();
    if (argv.dryRun) {
      console.log(`[rm -rf ${tmpBowerRepo}]`.grey, 'DRY RUN'.magenta);
    } else {
      rm('-rf', tmpBowerRepo);
    }
    console.log('Released: '.cyan + 'bower package'.green);
  } else {
    console.log('The "bowerRepo" is not set in package.json. Not publishing bower.'.yellow);
  }

  console.log('Version '.cyan + `v${newVersion}`.green + ' released!'.cyan);
}


//------------------------------------------------------------------------------
//
release(versionBumpOptions);
