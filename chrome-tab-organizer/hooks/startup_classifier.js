/**
 * @fileoverview startup_classifier.js - 扩展程序启动/安装时执行全量分类。
 */

import Logger from '../utils/logger.js';
import { tabManager } from '../services/tab_manager.js';
import { classificationService } from '../services/classification_service.js';
import { windowManager } from '../services/window_manager.js'; // 引入 windowManager

const logger = new Logger('StartupClassifier');

/**
 * StartupClassifier 类负责在扩展程序启动或安装时执行全量标签页分类。
 */
class StartupClassifier {
    /**
     * 构造函数。
     * @param {object} dependencies - 依赖注入对象。
     * @param {object} dependencies.tabManager - 标签页管理器实例。
     * @param {object} dependencies.classificationService - 分类服务实例。
     * @param {object} dependencies.windowManager - 窗口管理器实例。
     */
    constructor({ tabManager, classificationService, windowManager }) {
        this.tabManager = tabManager;
        this.classificationService = classificationService;
        this.windowManager = windowManager; // 添加 windowManager 依赖
        this._isClassifying = false; // 标志位，避免重复触发
    }

    /**
     * 执行启动时全量分类。
     * 查询所有现有标签页，并根据分类标识符统一管理窗口。
     * @param {number} [originalTabId] - 触发分类时用户所在的原始标签页 ID。
     * @returns {Promise<void>}
     */
    async runStartupClassification(originalTabId) {
        if (this._isClassifying) {
            logger.info('启动时分类已在进行中，跳过本次触发。');
            return;
        }

        this._isClassifying = true;
        logger.info('开始执行启动时全量标签页分类...');

        try {
            let allTabs = await this.tabManager.getAllTabs();

            // 过滤掉特殊页面 (chrome://, about:, etc.)
            const filteredTabs = allTabs.filter(tab => tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://')));
            const ignoredCount = allTabs.length - filteredTabs.length;
            if (ignoredCount > 0) {
                logger.info(`已忽略 ${ignoredCount} 个特殊页面 (如 chrome://)。`);
            }

            logger.info(`找到 ${filteredTabs.length} 个可分类的标签页。`);

            /**
             * 存储按分类标识符分组的标签页。
             * @type {Map<string, Array<chrome.tabs.Tab>>}
             */
            const classifiedTabs = new Map();
            /**
             * 存储原始窗口ID到其包含的标签页数量的映射，用于后续检查空窗口。
             * @type {Map<number, number>}
             */
            const originalWindowTabCounts = new Map();

            // 阶段1: 计算所有标签页的分类标识符并分组
            for (const tab of filteredTabs) { // 使用过滤后的列表
                // 记录原始窗口的标签页数量
                originalWindowTabCounts.set(tab.windowId, (originalWindowTabCounts.get(tab.windowId) || 0) + 1);

                const identifier = await this.classificationService.getClassificationIdentifier(tab);
                if (identifier) {
                    if (!classifiedTabs.has(identifier)) {
                        classifiedTabs.set(identifier, []);
                    }
                    classifiedTabs.get(identifier).push(tab);
                } else {
                    logger.debug(`标签页 ID=${tab.id}, URL=${tab.url} 不需要分类或无法获取标识符，保留在原窗口。`);
                }
            }

            logger.info(`已将标签页分组为 ${classifiedTabs.size} 个分类。`);

            // 阶段2: 根据分组结果统一管理窗口和移动标签页
            const windowsToCheckForEmpty = new Set(); // 收集需要检查是否变空的原始窗口ID

            for (const [identifier, tabsToMove] of classifiedTabs.entries()) {
                // 按 tab.id 升序排序，确保标签页按打开时间顺序组织
                // Chrome 的 tab.id 是递增的，ID 越小代表越早打开
                tabsToMove.sort((a, b) => a.id - b.id);

                let targetWindowId = this.windowManager.getWindowIdForIdentifier(identifier);
                let isNewWindowCreated = false;

                if (!targetWindowId) {
                    // 如果没有找到现有窗口，则为该分类创建一个新窗口
                    // 优先使用分组中的第一个标签页来创建新窗口，并将其移入
                    const firstTab = tabsToMove.shift(); // 移除第一个标签页，因为它将用于创建窗口
                    if (firstTab) {
                        logger.info(`未找到标识符 "${identifier}" 的现有窗口，正在为标签页 ID=${firstTab.id} 创建新窗口。`);
                        try {
                            targetWindowId = await this.tabManager.createNewWindowWithTab(firstTab.id);
                            this.windowManager.registerClassificationWindow(targetWindowId, identifier);
                            logger.info(`为标识符 "${identifier}" 创建并注册了新窗口 ID=${targetWindowId}。`);
                            isNewWindowCreated = true;
                            windowsToCheckForEmpty.add(firstTab.windowId); // 记录原始窗口ID
                        } catch (error) {
                            logger.error(`为标识符 "${identifier}" 创建新窗口失败: ${error.message}`);
                            continue; // 跳过当前分类组的后续处理
                        }
                    } else {
                        logger.warn(`分类标识符 "${identifier}" 没有可用于创建新窗口的标签页，跳过。`);
                        continue;
                    }
                } else {
                    logger.debug(`找到标识符 "${identifier}" 的现有窗口 ID=${targetWindowId}。`);
                }

                // 将剩余的标签页移动到目标窗口，使用索引确保顺序
                let tabIndex = -1; // -1 表示追加到末尾
                for (const tab of tabsToMove) {
                    if (tab.windowId !== targetWindowId) {
                        try {
                            await this.tabManager.moveTabToWindow(tab.id, targetWindowId, tabIndex);
                            logger.info(`标签页 ID=${tab.id} 已移动到窗口 ID=${targetWindowId}。`);
                            windowsToCheckForEmpty.add(tab.windowId); // 记录原始窗口ID
                        } catch (error) {
                            logger.error(`移动标签页 ID=${tab.id} 失败: ${error.message}`);
                        }
                    } else {
                        logger.debug(`标签页 ID=${tab.id} 已在目标窗口 ID=${targetWindowId} 中，无需移动。`);
                    }
                }
            }

            // 阶段3: 检查并关闭可能变空的原始窗口
            logger.info('正在检查可能变空的原始窗口...');
            for (const windowId of windowsToCheckForEmpty) {
                // 只有当原始窗口的标签页数量减少到0时才检查，避免不必要的查询
                // 实际上，checkAndCloseEmptyWindow 内部会查询，这里可以简化
                await this.windowManager.checkAndCloseEmptyWindow(windowId);
            }

            // 阶段4: 重新激活原始标签页
            if (originalTabId) {
                try {
                    // 检查标签页是否仍然存在
                    await chrome.tabs.get(originalTabId);
                    await this.tabManager.activateTab(originalTabId);
                    logger.info(`已重新激活原始标签页 ID=${originalTabId}。`);
                } catch (error) {
                    // 如果标签页已关闭（例如，它所在的窗口被关闭），则记录错误
                    logger.warn(`无法重新激活原始标签页 ID=${originalTabId}，可能已被关闭: ${error.message}`);
                }
            }

            logger.info('启动时全量标签页分类完成。');
        } catch (error) {
            logger.error(`执行启动时分类失败: ${error.message}`);
        } finally {
            this._isClassifying = false;
        }
    }
}

export const startupClassifier = new StartupClassifier({
    tabManager,
    classificationService,
    windowManager // 注入 windowManager
});
