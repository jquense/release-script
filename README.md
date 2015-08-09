# release-script

Release tool for npm and bower packages.

With this tool there is no need to keep (transpiled) `lib`, `build`
or `distr` files in the git repo.

Because `Bower` keeps its files in the github repo,
this tools helps to deal with that too.

Just create new additional github repo for `Bower` version of your project.
This repo will contain only commits generated by this tool.

Say the name of your project is
`original-project-name`
then name the `bower` github repo as
`original-project-name-bower`.

Add `'release-script'.bowerRepo` into your `package.json`:
```js
"release-script": {
  "bowerRepo": "git@github.com:<author>/original-project-name-bower.git"
}
```

Then add additional step into your building process,
which will create `bower` package files in the `amd` folder,
(basically it is just a process of copying the `lib` files, README and LICENSE)
and that's all.

Now `release-script` will do all those steps (described next),
including `bower` publishing, for you - automatically.


_Initial idea is got from `React-Bootstrap` release tools `./tools/release`,
that have been written by [Matt Smith @mtscout6](https://github.com/mtscout6)_

#### Options

All options for this package are kept under `'release-script'` node in your project's `package.json`

- `bowerRepo` - the full url to github project for the bower pkg files
- `bowerRoot` - the folder name where your `npm run build` command will put/transpile files for bower pkg
  - `default` value: `'amd'`
- `tmpBowerRepo` - the folder name for temporary files for bower pkg.
  - `default` value: `'tmp-bower-repo'`

It is advised to add `bowerRoot` and `tmpBowerRepo` folders to your `.gitignore` file.

All options are optional.

E.g.:
```js
"release-script": {
  "bowerRepo": "git@github.com:<org-author-name>/<name-of-project>-bower.git",
  "bowerRoot": "amd",
  "tmpBowerRepo": "tmp-bower-repo"
}
```

#### GitHub releases

If you want this script to publish github releases,
you can generate token https://github.com/settings/tokens for it
and set `env.GITHUB_TOKEN` to it like this:
```sh
> GITHUB_TOKEN="xxxxxxxxxxxx" && release-script patch
```
or through your shell scripts
```sh
export GITHUB_TOKEN="xxxxxxxxxxxx"
```
You can set a custom message for release via `--notes` CLI option:
```
> release patch --notes "This is small fix"
```


#### This script does following steps:

- ensures that git repo has no pending changes
- ensures that git repo last version is fetched
- checks linting and tests by running `npm run test` command
- does version bump, with `preid` if it is requested
- builds all by running `npm run build` command
  - If there is no `build` script, then `release-script` just skips the `build` step.
- if one of `[rf|mt]-changelog` is used in 'devDependencies', then changelog is generated
- adds and commits changed `package.json` (and `CHANGELOG.md`, if used) files to git repo
- adds git tag with new version (and changelog message, if used)
- pushes changes to github repo
- if github token is present, publishes release to GitHub, named as `<repo> vx.x.x`
- releases npm package by `npm publish` command
- if `bowerRepo` field is present in the `package.json`, then it releases bower package:
  - clones bower repo to local `tmpBowerRepo` temp folder. `git clone bowerRepo tmpBowerRepo`
  - then it cleans up all but `.git` files in the `tmpBowerRepo`
  - then copies all files from `bowerRoot` to `tmpBowerRepo`
    - (that has to be generated with `npm run build`)
  - then by `git add -A .` adds all bower distr files to the temporary git repo
  - commits, tags and pushes the same as for the `npm` package.
  - then deletes the `tmpBowerRepo` folder

## Installation

```sh
> npm install -D release-script
```

If you need `bower` releases too, then add `'release-script'.bowerRepo` into your `package.json` like this:
```js
"release-script": {
  "bowerRepo": "git@github.com:<org-author-name>/<name-of-project>-bower.git"
}
```

Then you can release like that:
```sh
> release patch
> release minor --preid alpha
```

You can use `--dry-run` option to check first what will be done and if it is OK.
```sh
> release major --dry-run --verbose
```
This option prevents `danger` steps from running. (`git push`, `npm publish` etc)

If you don't have smth like that in your shell:
```sh
# npm
export PATH="./node_modules/.bin:$PATH"
```
then you have to type the commands like this:
```sh
> ./node_modules/.bin/release minor --preid alpha
```

Or you just can install `release-script` globally.

You also can add some helpful `script` commands to your `package.json`,
and because `npm` adds `node_modules/.bin` into `PATH` for running scripts automatically,
you can add them just like that:
```js
"scripts": {
    ...
    "patch": "release patch",
    "minor": "release minor",
    "major": "release major"
```

Also you can add it like this:
```js
"scripts": {
    ...
    "release": "release",
```
And then you can run it like that:
```
> npm run release minor -- --preid alpha
> npm run release patch -- --notes "This is small fix"
> npm run release major -- --dry-run
etc
```
_Notice: you have to add additional `--` before any `--option`. That way additional options will get straight to `release-script`._


## License
`release-script` is licensed under the [MIT License](https://github.com/alexkval/release-script/blob/master/LICENSE).
