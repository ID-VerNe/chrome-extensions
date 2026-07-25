/**
 * @fileoverview logger.js - 封装日志记录功能。
 */

/**
 * Logger 类提供统一的日志记录接口。
 */
class Logger {
    /**
     * 构造函数。
     * @param {string} prefix - 日志前缀，用于标识日志来源模块。
     */
    constructor(prefix) {
        this.prefix = `[${prefix}]`;
    }

    /**
     * 记录调试信息。
     * @param {string} message - 日志消息。
     * @param {any[]} args - 附加参数。
     */
    debug(message, ...args) {
        console.debug(`${this.prefix} DEBUG: ${message}`, ...args);
    }

    /**
     * 记录信息。
     * @param {string} message - 日志消息。
     * @param {any[]} args - 附加参数。
     */
    info(message, ...args) {
        console.info(`${this.prefix} INFO: ${message}`, ...args);
    }

    /**
     * 记录警告信息。
     * @param {string} message - 日志消息。
     * @param {any[]} args - 附加参数。
     */
    warn(message, ...args) {
        console.warn(`${this.prefix} WARN: ${message}`, ...args);
    }

    /**
     * 记录错误信息。
     * @param {string} message - 日志消息。
     * @param {any[]} args - 附加参数。
     */
    error(message, ...args) {
        console.error(`${this.prefix} ERROR: ${message}`, ...args);
    }
}

export default Logger;
