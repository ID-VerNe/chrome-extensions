/**
 * @fileoverview background.js - Chrome 扩展程序的 Service Worker 主文件。
 * 负责监听浏览器事件并协调各服务模块执行核心逻辑。
 */

import Logger from './utils/logger.js';
import { configManager } from './utils/config.js';
import { classificationService } from './services/classification_service.js';
import { windowManager } from './services/window_manager.js';
import { startupClassifier } from './hooks/startup_classifier.js';
import { tabManager } from './services/tab_manager.js'; // 导入 tabManager

const logger = new Logger('Background');

/**
 * 初始化函数，在 Service Worker 启动时运行。
 * 加载配置并设置事件监听器。
 */
async function initialize() {
    logger.info('Service Worker 正在初始化...');
    await configManager.loadConfig(); // 确保配置在启动时加载
    await windowManager.loadPersistedWindows(); // 加载持久化的窗口映射
    registerEventListeners();
    logger.info('Service Worker 初始化完成。');
}

/**
 * 注册所有必要的 Chrome API 事件监听器。
 */
function registerEventListeners() {
    logger.info('注册事件监听器...');


    // 监听标签页移除事件
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
        logger.debug(`捕获到 tabs.onRemoved 事件: Tab ID=${tabId}, Window ID=${removeInfo.windowId}`);
        // 检查标签页所在的窗口是否需要关闭
        if (!removeInfo.isWindowClosing) { // 只有当窗口不是整体关闭时才检查
            windowManager.checkAndCloseEmptyWindow(removeInfo.windowId);
        }
    });

    // 监听窗口移除事件
    chrome.windows.onRemoved.addListener((windowId) => {
        logger.debug(`捕获到 windows.onRemoved 事件: Window ID=${windowId}`);
        windowManager.unregisterWindow(windowId);
    });

    // 监听扩展程序安装或更新事件
    chrome.runtime.onInstalled.addListener((details) => {
        logger.info(`捕获到 runtime.onInstalled 事件: Reason=${details.reason}`);
        // 扩展程序安装或更新时，不再自动触发全量分类，等待用户点击
    });

    // 监听浏览器启动事件
    chrome.runtime.onStartup.addListener(() => {
        logger.info('捕获到 runtime.onStartup 事件。');
        // 浏览器启动时，不再自动触发全量分类，等待用户点击
    });

    // 监听来自 options 页面或其他脚本的消息 (如果需要)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        logger.debug('收到消息:', message);
        // 示例: 如果 options 页面需要触发全量分类
        if (message.action === 'runFullClassification') {
            startupClassifier.runStartupClassification();
            sendResponse({ status: 'started' });
            return true; // 表示异步响应
        }
    });

}

// 监听扩展程序图标点击事件，触发全量分类
setTimeout(() => {
  chrome.action.onClicked.addListener(async (tab) => { // tab 参数包含了当前点击的标签页信息
      logger.info('捕获到 action.onClicked 事件，正在执行全量分类...');
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs.length > 0) {
          const originalTabId = activeTabs[0].id;
          logger.info(`原始激活标签页 ID: ${originalTabId}`);
          startupClassifier.runStartupClassification(originalTabId); // 将原始标签页 ID 传递给分类器
      } else {
          logger.warn('未找到当前激活的标签页。');
          startupClassifier.runStartupClassification(); // 如果没有找到，仍然执行分类
      }
  });
}, 0);

// 启动初始化过程
initialize();
