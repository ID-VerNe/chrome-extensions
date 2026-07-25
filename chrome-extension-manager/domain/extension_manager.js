'use strict';

import { createLogger } from '../utils/logger.js';

const logger = createLogger('ExtensionManager');

/**
 * 获取所有已安装的扩展信息。
 * @returns {Promise<Array>} 一个包含所有扩展对象的数组。
 */
const getAllExtensions = async () => {
    logger.info('开始获取所有扩展...');
    try {
        const extensions = await new Promise((resolve) => {
            chrome.management.getAll(resolve);
        });
        logger.info(`成功获取 ${extensions.length} 个扩展。`);
        return extensions;
    } catch (error) {
        logger.error('获取所有扩展时出错:', error);
        throw error;
    }
};

/**
 * 设置扩展的启用状态。
 * @param {string} id - 扩展的ID。
 * @param {boolean} enabled - true表示启用，false表示禁用。
 * @returns {Promise<void>}
 */
const setEnabled = async (id, enabled) => {
    logger.info(`准备设置扩展 ${id} 的状态为: ${enabled}`);
    try {
        await new Promise((resolve, reject) => {
            chrome.management.setEnabled(id, enabled, () => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve();
            });
        });
        logger.info(`成功设置扩展 ${id} 的状态为 ${enabled}。`);
    } catch (error) {
        logger.error(`设置扩展 ${id} 状态时出错:`, error);
        throw error;
    }
};

/**
 * 卸载一个扩展。
 * @param {string} id - 扩展的ID。
 * @returns {Promise<void>}
 */
const uninstall = async (id) => {
    logger.info(`准备卸载扩展 ${id}`);
    try {
        await new Promise((resolve, reject) => {
            // 使用内置的确认对话框
            const options = { showConfirmDialog: true };
            chrome.management.uninstall(id, options, () => {
                if (chrome.runtime.lastError) {
                    // 用户取消卸载也会产生一个 error，需要检查 message
                    if (chrome.runtime.lastError.message !== 'User cancelled the uninstall.') {
                       return reject(chrome.runtime.lastError);
                    }
                    logger.warn(`用户取消了卸载扩展 ${id}。`);
                }
                resolve();
            });
        });
        logger.info(`扩展 ${id} 的卸载流程已处理。`);
    } catch (error) {
        logger.error(`卸载扩展 ${id} 时出错:`, error);
        throw error;
    }
};

/**
 * 打开扩展的选项页面。
 * @param {string} optionsUrl - 选项页面的URL。
 * @returns {Promise<void>}
 */
const openOptionsPage = async (optionsUrl) => {
    logger.info(`准备打开选项页面: ${optionsUrl}`);
    try {
        await chrome.tabs.create({ url: optionsUrl });
        logger.info(`成功打开选项页面: ${optionsUrl}`);
    } catch (error) {
        logger.error(`打开选项页面 ${optionsUrl} 时出错:`, error);
        throw error;
    }
};

/**
 * 对 chrome.storage.local 的简单封装
 */
const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};

export { getAllExtensions, setEnabled, uninstall, openOptionsPage, storage };
