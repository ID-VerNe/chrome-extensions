/**
 * @fileoverview tab_manager.js - 封装标签页的移动、查询和新窗口创建。
 */

import Logger from '../utils/logger.js';

const logger = new Logger('TabManager');

/**
 * TabManager 类封装了 Chrome Tabs API 的常用操作。
 */
class TabManager {
    /**
     * 构造函数。
     */
    constructor() {}

    /**
     * 将标签页移动到指定窗口。
     * @param {number} tabId - 要移动的标签页 ID。
     * @param {number} targetWindowId - 目标窗口的 ID。
     * @param {number} [index] - 标签页在目标窗口中的位置索引。
     * @returns {Promise<chrome.tabs.Tab>} 移动后的标签页对象。
     */
    async moveTabToWindow(tabId, targetWindowId, index) {
        logger.info(`正在移动标签页 ID=${tabId} 到窗口 ID=${targetWindowId}, 索引: ${index !== undefined ? index : '自动'}`);
        try {
            const tab = await chrome.tabs.move(tabId, { windowId: targetWindowId, index: index !== undefined ? index : -1 });
            logger.info(`标签页 ID=${tabId} 成功移动到窗口 ID=${targetWindowId}。`);
            return tab;
        } catch (error) {
            logger.error(`移动标签页 ID=${tabId} 失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 创建一个新窗口并将指定的标签页移入。
     * 如果标签页是新创建的，它可能已经在一个临时窗口中，需要先将其移出。
     * @param {number} tabId - 要移入新窗口的标签页 ID。
     * @returns {Promise<number>} 新创建的窗口 ID。
     */
    async createNewWindowWithTab(tabId) {
        logger.info(`正在为标签页 ID=${tabId} 创建新窗口。`);
        try {
            // 创建一个新窗口，并将其最大化
            const newWindow = await chrome.windows.create({ tabId: tabId, type: 'normal', state: 'maximized' });
            logger.info(`新窗口 ID=${newWindow.id} 已创建，标签页 ID=${tabId} 已移入。`);

            // 检查新窗口是否包含默认的新标签页，并关闭它
            if (newWindow.tabs && newWindow.tabs.length > 1) {
                const defaultNewTab = newWindow.tabs.find(tab => tab.id !== tabId && tab.url.startsWith('chrome://newtab/'));
                if (defaultNewTab) {
                    logger.debug(`关闭新窗口中默认的新标签页 ID=${defaultNewTab.id}`);
                    await chrome.tabs.remove(defaultNewTab.id);
                }
            }
            return newWindow.id;
        } catch (error) {
            logger.error(`为标签页 ID=${tabId} 创建新窗口失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 查询指定窗口中的所有标签页信息。
     * @param {number} windowId - 要查询的窗口 ID。
     * @returns {Promise<chrome.tabs.Tab[]>} 窗口中的所有标签页数组。
     */
    async queryTabsInWindow(windowId) {
        logger.debug(`正在查询窗口 ID=${windowId} 中的标签页。`);
        try {
            const tabs = await chrome.tabs.query({ windowId: windowId });
            logger.debug(`窗口 ID=${windowId} 中找到 ${tabs.length} 个标签页。`);
            return tabs;
        } catch (error) {
            logger.error(`查询窗口 ID=${windowId} 中的标签页失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取所有窗口中的所有标签页。
     * @returns {Promise<chrome.tabs.Tab[]>} 所有标签页的数组。
     */
    async getAllTabs() {
        logger.info('正在获取所有标签页。');
        try {
            const tabs = await chrome.tabs.query({});
            logger.info(`找到 ${tabs.length} 个标签页。`);
            return tabs;
        } catch (error) {
            logger.error(`获取所有标签页失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 激活指定的标签页，并将其所在窗口置于前台。
     * @param {number} tabId - 要激活的标签页 ID。
     * @returns {Promise<void>}
     */
    async activateTab(tabId) {
        logger.info(`正在激活标签页 ID=${tabId}。`);
        try {
            // 先获取标签页信息，得到其所在的窗口 ID
            const tab = await chrome.tabs.get(tabId);
            const windowId = tab.windowId;
            
            // 激活标签页
            await chrome.tabs.update(tabId, { active: true });
            
            // 将窗口置于前台
            await chrome.windows.update(windowId, { focused: true });
            
            logger.info(`标签页 ID=${tabId} 已激活，窗口 ID=${windowId} 已聚焦。`);
        } catch (error) {
            logger.error(`激活标签页 ID=${tabId} 失败: ${error.message}`);
            throw error;
        }
    }
}

export const tabManager = new TabManager();
