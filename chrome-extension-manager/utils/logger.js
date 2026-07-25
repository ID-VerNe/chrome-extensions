'use strict';

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

const createLogger = (context) => {
  const log = (level, message, ...args) => {
    console.log(`[${new Date().toISOString()}] [${level}] [${context}] -`, message, ...args);
  };

  return {
    debug: (message, ...args) => log(LOG_LEVELS.DEBUG, message, ...args),
    info: (message, ...args) => log(LOG_LEVELS.INFO, message, ...args),
    warn: (message, ...args) => log(LOG_LEVELS.WARN, message, ...args),
    error: (message, ...args) => log(LOG_LEVELS.ERROR, message, ...args),
  };
};

export { createLogger };