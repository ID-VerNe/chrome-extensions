/**
 * @fileoverview config.js - 管理扩展程序的配置加载和默认值。
 */

import Logger from './logger.js';

const logger = new Logger('Config');

/**
 * 默认配置值。
 * @type {object}
 */
const DEFAULT_CONFIG = {
    classificationType: 'hostname', // 'hostname' or 'tld'
    blacklist: [], // Array<string> of URL patterns
    customGroups: [] // Array<{ pattern: string, groupName: string }>
};

/**
 * ConfigManager 类负责从 chrome.storage.sync 读取、保存和管理配置。
 */
class ConfigManager {
    /**
     * 构造函数。
     */
    constructor() {
        /**
         * 当前加载的配置。
         * @type {object}
         * @private
         */
        this._config = null;
    }

    /**
     * 从 chrome.storage.sync 加载配置。如果存储中没有配置，则使用默认值。
     * @returns {Promise<object>} 包含当前配置的 Promise。
     */
    async loadConfig() {
        logger.info('正在加载配置...');
        try {
            const storedConfig = await chrome.storage.sync.get(DEFAULT_CONFIG);
            this._config = { ...DEFAULT_CONFIG, ...storedConfig };
            logger.info('配置加载成功:', this._config);
            return this._config;
        } catch (error) {
            logger.error('加载配置失败:', error);
            this._config = DEFAULT_CONFIG; // 加载失败时使用默认配置
            return this._config;
        }
    }

    /**
     * 获取当前配置。如果配置尚未加载，则会先加载。
     * @returns {Promise<object>} 包含当前配置的 Promise。
     */
    async getConfig() {
        if (!this._config) {
            await this.loadConfig();
        }
        return this._config;
    }

    /**
     * 保存配置到 chrome.storage.sync。
     * @param {object} newConfig - 要保存的新配置对象。
     * @returns {Promise<void>}
     */
    async saveConfig(newConfig) {
        logger.info('正在保存配置:', newConfig);
        try {
            await chrome.storage.sync.set(newConfig);
            this._config = { ...this._config, ...newConfig }; // 更新内部缓存
            logger.info('配置保存成功。');
        } catch (error) {
            logger.error('保存配置失败:', error);
            throw error; // 抛出错误以便调用者处理
        }
    }

    /**
     * 获取指定配置项的值。
     * @param {string} key - 配置项的键。
     * @returns {any} 配置项的值。
     */
    get(key) {
        if (!this._config) {
            logger.warn(`配置未加载，尝试获取键 "${key}"。请先调用 loadConfig() 或 getConfig()。`);
            return DEFAULT_CONFIG[key]; // 返回默认值以避免 undefined
        }
        return this._config[key];
    }
}

export const configManager = new ConfigManager();
