const hostedGitInfo = require('hosted-git-info');
const validateProjectName = require('validate-npm-package-name');
const env = require('@shopify/slate-env');
const analytics = require('@shopify/slate-analytics');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const utils = require('./utils');
const config = require('./create-slate-theme.config');
const packageJson = require('./package.json');

module.exports = async function createSlateTheme(name, starter, flags) {
  const root = path.resolve(name);
  const options = Object.assign(config.defaultOptions, flags);

  checkAppName(name);
  fs.ensureDirSync(root);
  checkDirForConflicts(root);

  await analytics.init();
  analytics.event('create-slate-theme:start', {
    version: packageJson,
    starter,
    skipInstall: options.skipInstall,
    verbose: options.verbose,
  });

  console.log(`Creating a new Slate theme in: ${chalk.green(root)}.`);

  await getStarterTheme(root, starter, options.verbose);
  await env.create({root});
  await installThemeDeps(root, options);

  analytics.event('create-slate-theme:success', {
    version: packageJson,
  });
};

function checkAppName(name) {
  const validationResult = validateProjectName(name);
  if (!validationResult.validForNewPackages) {
    console.error(
      `Could not create a project called ${chalk.red(
        `"${name}"`,
      )} because of npm naming restrictions:`,
    );
    printValidationResults(validationResult.errors);
    printValidationResults(validationResult.warnings);

    process.exit(1);
  }
}

function printValidationResults(results) {
  if (typeof results !== 'undefined') {
    results.forEach(error => {
      console.error(chalk.red(`  *  ${error}`));
    });
  }
}

// If project only contains files generated by GH, it’s safe.
// We also special case IJ-based products .idea because it integrates with CRA:
// https://github.com/facebookincubator/create-react-app/pull/368#issuecomment-243446094
function checkDirForConflicts(root) {
  const files = fs.readdirSync(root);
  const conflicts = files.filter(file => !config.validFiles.includes(file));

  if (conflicts.length > 0) {
    console.log();
    console.log(
      `The directory ${chalk.green(root)} contains files that could conflict:`,
    );
    console.log();
    for (const file of conflicts) {
      console.log(`  ${file}`);
    }
    console.log();
    console.log(
      'Either try using a new directory name, or remove the files listed above.',
    );

    process.exit(1);
  }
}

// Executes `npm install` or `yarn install` in rootPath.
function installThemeDeps(root, options) {
  if (options.skipInstall) {
    console.log('Skipping theme dependency installation...');
    return Promise.resolve();
  }

  const prevDir = process.cwd();

  console.log('Installing theme dependencies...');
  process.chdir(root);

  const cmd = utils.shouldUseYarn()
    ? utils.spawn('yarnpkg')
    : utils.spawn('npm install');

  return cmd.then(() => process.chdir(prevDir));
}

// Copy starter from file system.
function copyFromDir(starter, root) {
  if (!fs.existsSync(starter)) {
    throw new Error(`starter ${starter} doesn't exist`);
  }

  // Chmod with 755.
  // 493 = parseInt('755', 8)
  return fs.mkdirp(root, {mode: 493}).then(() => {
    console.log(
      `Creating new theme from local starter: ${chalk.green(starter)}`,
    );
    return fs.copy(starter, root, {
      filter: file =>
        !/^\.(git|hg)$/.test(path.basename(file)) && !/node_modules/.test(file),
    });
  });
}

// Clones starter from URI.
function cloneFromGit(hostInfo, root, verbose) {
  const url = hostInfo.ssh({noCommittish: true});
  const branch = hostInfo.committish ? `-b ${hostInfo.committish}` : '';
  const options = {stdio: 'pipe'};

  if (verbose) {
    options.stdio = 'inherit';
  }

  console.log(`Cloning theme from a git repo: ${chalk.green(url)}`);

  return utils
    .spawn(`git clone ${branch} ${url} ${root} --single-branch`, options)
    .then(() => {
      return fs.remove(path.join(root, '.git'));
    })
    .catch(error => {
      console.log();
      console.log(chalk.red('There was an error while cloning the git repo:'));
      console.log('');
      console.log(chalk.red(error));

      process.exit(1);
    });
}

function getStarterTheme(root, starter, verbose) {
  const hostedInfo = hostedGitInfo.fromUrl(starter);

  if (hostedInfo) {
    return cloneFromGit(hostedInfo, root, verbose);
  } else {
    return copyFromDir(starter, root);
  }
}
