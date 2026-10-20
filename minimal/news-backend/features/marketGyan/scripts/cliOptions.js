// Commands compare flag values with the string 'true', so a bare `--force`
// must parse exactly like `--force=true` instead of being silently ignored.
const parseCliOptions = (argv) => Object.fromEntries(argv.map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : 'true'];
}));

module.exports = {
    parseCliOptions
};
