module.exports = {
  apps: [{
    name: "gold-price",
    script: 'src/index.ts',
    interpreter: "node",
    interpreter_args: "--import tsx",
    autorestart: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    watch: ['src/**/*.ts']
  }],
};
