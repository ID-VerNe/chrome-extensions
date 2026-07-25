/**
 * @fileoverview classification_service.js - 核心分类逻辑，根据配置和优先级判断标签页去向。
 */

import Logger from '../utils/logger.js';
import { configManager } from '../utils/config.js';
import { getSiteIdentifier } from '../utils/url_parser.js';
import { matchesAnyPattern } from '../utils/pattern_matcher.js';
import { windowManager } from './window_manager.js';
import { tabManager } from './tab_manager.js';

const logger = new Logger('ClassificationService');

/**
 * ClassificationService 类封装了核心分类逻辑。
 */
class ClassificationService {
    /**
     * 构造函数。
     * @param {object} dependencies - 依赖注入对象。
     * @param {object} dependencies.configManager - 配置管理器实例。
     * @param {function} dependencies.getSiteIdentifier - 获取站点标识符的函数。
     * @param {function} dependencies.matchesAnyPattern - 匹配任意模式的函数。
     * @param {object} dependencies.windowManager - 窗口管理器实例。
     * @param {object} dependencies.tabManager - 标签页管理器实例。
     */
    constructor({ configManager, getSiteIdentifier, matchesAnyPattern, windowManager, tabManager }) {
        this.configManager = configManager;
        this.getSiteIdentifier = getSiteIdentifier;
        this.matchesAnyPattern = matchesAnyPattern;
        this.windowManager = windowManager;
        this.tabManager = tabManager;
    }

    /**
     * 仅计算标签页的分类标识符，不执行任何窗口操作。
     * @param {chrome.tabs.Tab} tab - 要分类的标签页对象。
     * @returns {Promise<string|null>} 分类标识符，如果不需要分类则返回 null。
     */
    async getClassificationIdentifier(tab) {
        if (!tab.url || tab.url.startsWith('chrome://newtab/')) {
            logger.debug(`跳过新标签页或无效 URL 的标识符计算: ID=${tab.id}, URL=${tab.url}`);
            return null;
        }

        const config = await this.configManager.loadConfig(); // 强制重新加载确保获取最新配置
        const { classificationType, customGroups, blacklist } = config;
        logger.debug(`当前配置: type=${classificationType}, groups=${customGroups.length}, blacklist=${blacklist.length}`);

        let targetIdentifier = null;
        let isCustomGroup = false;

        // 1. 检查自定义分组 (最高优先级)
        for (const group of customGroups) {
            if (this.matchesAnyPattern(tab.url, [group.pattern])) {
                targetIdentifier = group.groupName;
                isCustomGroup = true;
                logger.debug(`标签页 ID=${tab.id} 匹配自定义分组 "${group.groupName}" (模式: ${group.pattern})`);
                break;
            }
        }

        // 2. 检查黑名单 (次优先级)
        if (!isCustomGroup && this.matchesAnyPattern(tab.url, blacklist)) {
            logger.debug(`标签页 ID=${tab.id} 匹配黑名单，不进行分类。`);
            return null; // 匹配黑名单，不分类
        }

        // 3. 获取通用网站标识符
        if (!targetIdentifier) {
            targetIdentifier = this.getSiteIdentifier(tab.url, classificationType);
            if (!targetIdentifier) {
                logger.warn(`无法为标签页 ID=${tab.id}, URL=${tab.url} 获取有效分类标识符。`);
                return null;
            }
            logger.debug(`标签页 ID=${tab.id} 的通用标识符: "${targetIdentifier}"`);
        }
        return targetIdentifier;
    }

    /**
     * 对单个标签页进行分类。
     * 此方法现在主要用于处理单个标签页的移动，而不是全量分类。
     * @param {chrome.tabs.Tab} tab - 要分类的标签页对象。
     * @returns {Promise<void>}
     */
    async classifyTab(tab) {
        logger.info(`正在分类标签页: ID=${tab.id}, URL=${tab.url}`);

        const targetIdentifier = await this.getClassificationIdentifier(tab);

        if (!targetIdentifier) {
            logger.info(`标签页 ID=${tab.id} 不需要分类 (Identifier 为空)，跳过处理。`);
            return;
        }

        logger.debug(`计算出的标识符: "${targetIdentifier}"`);

        // 查找或创建目标窗口
        let targetWindowId = this.windowManager.getWindowIdForIdentifier(targetIdentifier);

        if (targetWindowId) {
            logger.debug(`找到现有窗口 ID=${targetWindowId} 用于标识符 "${targetIdentifier}"。`);
            // 确保标签页不在目标窗口中，避免不必要的移动
            if (tab.windowId !== targetWindowId) {
                try {
                    await this.tabManager.moveTabToWindow(tab.id, targetWindowId);
                    logger.info(`标签页 ID=${tab.id} 已移动到现有窗口 ID=${targetWindowId}。`);
                    // 检查原窗口是否变空并关闭
                    await this.windowManager.checkAndCloseEmptyWindow(tab.windowId);
                } catch (error) {
                    logger.error(`移动标签页 ID=${tab.id} 失败: ${error.message}`);
                }
            } else {
                logger.debug(`标签页 ID=${tab.id} 已在目标窗口 ID=${targetWindowId} 中，无需移动。`);
            }
        } else {
            logger.info(`未找到标识符 "${targetIdentifier}" 的现有窗口，正在创建新窗口。`);
            try {
                const newWindowId = await this.tabManager.createNewWindowWithTab(tab.id);
                this.windowManager.registerClassificationWindow(newWindowId, targetIdentifier);
                logger.info(`为标签页 ID=${tab.id} 创建并注册了新窗口 ID=${newWindowId}。`);
                // 检查原窗口是否变空并关闭
                await this.windowManager.checkAndCloseEmptyWindow(tab.windowId);
            } catch (error) {
                logger.error(`创建新窗口并移动标签页 ID=${tab.id} 失败: ${error.message}`);
            }
        }
    }
}

export const classificationService = new ClassificationService({
    configManager,
    getSiteIdentifier,
    matchesAnyPattern,
    windowManager,
    tabManager
});
