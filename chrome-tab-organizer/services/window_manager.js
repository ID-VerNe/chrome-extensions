/**
 * @fileoverview window_manager.js - 管理分类窗口与分类标识符的映射，处理空窗口关闭。
 */

import Logger from '../utils/logger.js';

const logger = new Logger('WindowManager');

const STORAGE_KEY = 'classifiedWindows'; // 用于 chrome.storage.session 的键

/**
 * WindowManager 类负责维护分类窗口与标识符的映射，并处理空窗口的自动关闭。
 */
class WindowManager {
    /**
     * 构造函数。
     */
    constructor() {
        /**
         * 存储分类标识符到窗口 ID 的映射。
         * @type {Map<string, number>}
         * @private
         */
        this._classificationWindowMap = new Map();

        /**
         * 存储窗口 ID 到分类标识符的映射 (反向查找)。
         * @type {Map<number, string>}
         * @private
         */
        this._windowClassificationMap = new Map();
    }

    /**
     * 从持久化存储中加载已注册的分类窗口，并重建内存映射。
     * 在 Service Worker 启动时调用。
     * @returns {Promise<void>}
     */
    async loadPersistedWindows() {
        logger.info('正在从持久化存储加载分类窗口映射...');
        try {
            const result = await chrome.storage.session.get(STORAGE_KEY);
            const persistedData = result[STORAGE_KEY] || {};

            this._classificationWindowMap.clear();
            this._windowClassificationMap.clear();

            for (const identifier in persistedData) {
                const windowId = persistedData[identifier];
                // 验证窗口是否存在且有效
                try {
                    await chrome.windows.get(windowId); // 尝试获取窗口，如果不存在会抛出错误
                    this._classificationWindowMap.set(identifier, windowId);
                    this._windowClassificationMap.set(windowId, identifier);
                    logger.debug(`已加载持久化分类窗口: ID=${windowId}, 标识符="${identifier}"`);
                } catch (e) {
                    logger.warn(`持久化窗口 ID=${windowId} (标识符: ${identifier}) 不再存在，已跳过加载。`);
                    // 如果窗口不存在，从存储中移除无效记录
                    delete persistedData[identifier];
                }
            }
            // 清理存储中无效的记录
            await chrome.storage.session.set({ [STORAGE_KEY]: persistedData });
            logger.info(`分类窗口映射加载完成。加载了 ${this._classificationWindowMap.size} 个有效窗口。`);
        } catch (error) {
            logger.error(`加载持久化分类窗口映射失败: ${error.message}`);
        }
    }

    /**
     * 将当前内存中的分类窗口映射保存到持久化存储。
     * @returns {Promise<void>}
     * @private
     */
    async _saveCurrentMappingToStorage() {
        const dataToPersist = {};
        this._classificationWindowMap.forEach((windowId, identifier) => {
            dataToPersist[identifier] = windowId;
        });
        try {
            await chrome.storage.session.set({ [STORAGE_KEY]: dataToPersist });
            logger.debug('分类窗口映射已保存到持久化存储。');
        } catch (error) {
            logger.error(`保存分类窗口映射到持久化存储失败: ${error.message}`);
        }
    }

    /**
     * 注册一个分类窗口。
     * @param {number} windowId - Chrome 窗口的 ID。
     * @param {string} identifier - 对应的分类标识符 (自定义组名或通用网站标识)。
     */
    registerClassificationWindow(windowId, identifier) {
        logger.info(`注册分类窗口: ID=${windowId}, 标识符="${identifier}"`);
        this._classificationWindowMap.set(identifier, windowId);
        this._windowClassificationMap.set(windowId, identifier);
        this._saveCurrentMappingToStorage(); // 持久化
    }

    /**
     * 获取给定标识符对应的分类窗口 ID。
     * @param {string} identifier - 分类标识符。
     * @returns {number|undefined} 对应的窗口 ID，如果不存在则返回 undefined。
     */
    getWindowIdForIdentifier(identifier) {
        const windowId = this._classificationWindowMap.get(identifier);
        logger.debug(`查找标识符 "${identifier}" 对应的窗口 ID: ${windowId || '未找到'}`);
        return windowId;
    }

    /**
     * 注销一个窗口。当窗口关闭时调用。
     * @param {number} windowId - 要注销的窗口 ID。
     */
    unregisterWindow(windowId) {
        const identifier = this._windowClassificationMap.get(windowId);
        if (identifier) {
            logger.info(`注销窗口: ID=${windowId}, 标识符="${identifier}"`);
            this._classificationWindowMap.delete(identifier);
            this._windowClassificationMap.delete(windowId);
            this._saveCurrentMappingToStorage(); // 持久化
        } else {
            logger.debug(`尝试注销非分类窗口或已注销的窗口: ID=${windowId}`);
        }
    }

    /**
     * 检查给定窗口是否仅包含一个新标签页，如果是且该窗口是本扩展管理的分类窗口，则关闭它。
     * @param {number} windowId - 要检查的窗口 ID。
     * @returns {Promise<boolean>} 如果窗口被关闭则返回 true，否则返回 false。
     */
    async checkAndCloseEmptyWindow(windowId) {
        logger.debug(`检查窗口是否为空并需要关闭: ID=${windowId}`);
        if (!this._windowClassificationMap.has(windowId)) {
            logger.debug(`窗口 ID=${windowId} 不是本扩展管理的分类窗口，不处理。`);
            return false;
        }

        try {
            const tabs = await chrome.tabs.query({ windowId: windowId });
            const nonNewTabCount = tabs.filter(tab => !tab.url.startsWith('chrome://newtab/')).length;

            if (nonNewTabCount === 0) {
                logger.info(`窗口 ID=${windowId} 为空（或只包含新标签页），正在关闭。`);
                await chrome.windows.remove(windowId);
                // chrome.windows.remove 会触发 onRemoved 事件，该事件会调用 unregisterWindow，
                // 所以这里不需要再次手动调用 unregisterWindow。
                return true;
            } else {
                logger.debug(`窗口 ID=${windowId} 包含 ${nonNewTabCount} 个非新标签页，不关闭。`);
                return false;
            }
        } catch (error) {
            logger.error(`检查或关闭空窗口失败: ID=${windowId}, 错误: ${error.message}`);
            return false;
        }
    }
}

export const windowManager = new WindowManager();
