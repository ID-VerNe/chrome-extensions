'use strict';

import CONFIG from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import {
  getAllExtensions,
  setEnabled,
  uninstall,
  openOptionsPage,
  storage
} from '../domain/extension_manager.js';

const logger = createLogger('MainApp');

class ExtensionManagerApp {
  /**
   * 构造函数
   */
  constructor() {
    this.elements = {
      list: document.getElementById(CONFIG.ELEMENT_IDS.EXTENSION_LIST),
      template: document.getElementById(CONFIG.ELEMENT_IDS.ITEM_TEMPLATE),
      searchBox: document.getElementById(CONFIG.ELEMENT_IDS.SEARCH_BOX),
      loadingSpinner: document.getElementById(CONFIG.ELEMENT_IDS.LOADING_SPINNER),
      emptyState: document.getElementById(CONFIG.ELEMENT_IDS.EMPTY_STATE),
    };
    this.allExtensions = [];
    this.pinnedExtensions = [];
    this.draggedElement = null;
  }

  /**
   * 初始化应用
   */
  async init() {
    logger.info('应用开始初始化...');
    this.setupEventListeners();
    await this.loadPinnedExtensions();
    await this.render();
    logger.info('应用初始化完成。');
  }

  /**
   * 渲染所有扩展
   */
  async render() {
    logger.info('开始渲染扩展列表...');
    this.showLoading(true);
    this.elements.list.innerHTML = '';
    
    try {
      const extensions = await getAllExtensions();
      const ownExtension = await chrome.management.getSelf();

      this.allExtensions = extensions
        .filter(ext => ext.id !== ownExtension.id && ext.type === 'extension')
        .sort((a, b) => {
          const aIndex = this.pinnedExtensions.indexOf(a.id);
          const bIndex = this.pinnedExtensions.indexOf(b.id);
          const aIsPinned = aIndex !== -1;
          const bIsPinned = bIndex !== -1;

          if (aIsPinned && bIsPinned) {
            return aIndex - bIndex;
          }
          if (aIsPinned !== bIsPinned) {
            return aIsPinned ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      
      logger.info(`过滤并排序后，准备渲染 ${this.allExtensions.length} 个扩展。`);

      if (this.allExtensions.length === 0) {
        this.showEmptyState(true);
      } else {
        this.allExtensions.forEach(ext => this.createExtensionItem(ext));
        this.filterExtensions();
      }
    } catch (error) {
      logger.error('渲染扩展时发生严重错误:', error);
      this.elements.list.innerHTML = `<p style="color: red; text-align: center; padding: 20px;">加载扩展失败，请重试。</p>`;
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * 创建单个扩展的DOM元素
   * @param {object} extension - 扩展信息对象
   */
  createExtensionItem(extension) {
    const item = this.elements.template.content.firstElementChild.cloneNode(true);
    const isPinned = this.pinnedExtensions.indexOf(extension.id) !== -1;
    
    item.dataset.id = extension.id;
    item.dataset.name = extension.name.toLowerCase();
    
    // 只有固定的扩展才允许拖拽排序
    if (isPinned) {
      item.draggable = true;
      item.classList.add(CONFIG.CSS_CLASSES.PINNED);
      
      item.addEventListener('dragstart', (e) => this.handleDragStart(e, extension.id));
      item.addEventListener('dragover', (e) => this.handleDragOver(e));
      item.addEventListener('dragleave', (e) => this.handleDragLeave(e));
      item.addEventListener('drop', (e) => this.handleDrop(e));
      item.addEventListener('dragend', (e) => this.handleDragEnd(e));
    }

    const icon = item.querySelector(`.${CONFIG.CSS_CLASSES.ICON}`);
    const highestResIcon = extension.icons?.sort((a, b) => b.size - a.size)[0];
    icon.src = highestResIcon?.url || CONFIG.DEFAULT_ICON_URL;
    icon.alt = `${extension.name} icon`;

    const infoContainer = item.querySelector(`.${CONFIG.CSS_CLASSES.INFO}`);
    item.querySelector(`.${CONFIG.CSS_CLASSES.NAME}`).textContent = extension.name;
    item.querySelector(`.${CONFIG.CSS_CLASSES.VERSION}`).textContent = `v${extension.version}`;

    // 智能触发逻辑：禁用时点击头像即启用，启用时点击头像即开设置
    const handleIdentifyClick = async (e) => {
      e.preventDefault();
      if (!extension.enabled) {
        logger.info(`扩展 ${extension.id} 已禁用，正在通过点击触发启用...`);
        try {
          await setEnabled(extension.id, true);
          await this.render(); // 启用后立即重绘，让它变亮
        } catch (error) {
          logger.error('启用失败:', error);
        }
      } else if (extension.optionsUrl) {
        logger.info(`扩展已启用，打开选项页: ${extension.optionsUrl}`);
        this.handleOptions(extension.optionsUrl);
      } else {
        // 如果既没有设置页也已启用，则去详情页
        chrome.tabs.create({ url: `chrome://extensions/?id=${extension.id}` });
      }
    };

    icon.style.cursor = 'pointer';
    infoContainer.style.cursor = 'pointer';
    icon.addEventListener('click', handleIdentifyClick);
    infoContainer.addEventListener('click', handleIdentifyClick);

    const toggle = item.querySelector(`.${CONFIG.CSS_CLASSES.TOGGLE_INPUT}`);
    toggle.checked = extension.enabled;
    item.classList.toggle(CONFIG.CSS_CLASSES.ITEM_DISABLED, !extension.enabled);

    toggle.addEventListener('change', (e) => this.handleToggle(e, extension.id, item));

    const optionsBtn = item.querySelector(`.${CONFIG.CSS_CLASSES.OPTIONS_BTN}`);
    // 齿轮按钮现在统一负责“管理”：打开详情页
    optionsBtn.disabled = false;
    optionsBtn.title = "查看扩展详情与权限";
    optionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: `chrome://extensions/?id=${extension.id}` });
    });

    const uninstallBtn = item.querySelector(`.${CONFIG.CSS_CLASSES.UNINSTALL_BTN}`);
    uninstallBtn.addEventListener('click', () => this.handleUninstall(extension.id, item));

    const pinBtn = item.querySelector(`.${CONFIG.CSS_CLASSES.PIN_BTN}`);
    pinBtn.addEventListener('click', () => this.handlePin(extension.id));

    this.elements.list.appendChild(item);
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    logger.debug('设置事件监听器...');
    this.elements.searchBox.addEventListener('input', () => this.filterExtensions());
  }

  /**
   * 从存储中加载固定的扩展
   */
  async loadPinnedExtensions() {
    const { pinned = [] } = await storage.get('pinned');
    this.pinnedExtensions = Array.isArray(pinned) ? pinned : [];
    logger.info('已加载固定的扩展列表:', this.pinnedExtensions);
  }

  /**
   * 处理固定/取消固定
   * @param {string} id - 扩展ID
   */
  async handlePin(id) {
    logger.info(`用户点击固定/取消固定扩展 ${id}`);
    const index = this.pinnedExtensions.indexOf(id);
    if (index !== -1) {
      this.pinnedExtensions.splice(index, 1);
    } else {
      this.pinnedExtensions.push(id);
    }
    await storage.set({ pinned: this.pinnedExtensions });
    await this.render();
  }

  /**
   * 拖拽开始处理函数
   */
  handleDragStart(e, id) {
    this.draggedElement = e.target.closest(`.${CONFIG.CSS_CLASSES.ITEM}`);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    this.draggedElement.classList.add('dragging');
  }

  /**
   * 拖拽经过处理函数
   */
  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const targetItem = e.target.closest(`.${CONFIG.CSS_CLASSES.ITEM}`);
    if (targetItem && targetItem !== this.draggedElement) {
      const targetId = targetItem.dataset.id;
      // 仅允许在固定区域内进行位置互换
      if (this.pinnedExtensions.indexOf(targetId) !== -1) {
        targetItem.classList.add('drag-over');
      }
    }
  }

  /**
   * 拖拽离开处理函数
   */
  handleDragLeave(e) {
    const targetItem = e.target.closest(`.${CONFIG.CSS_CLASSES.ITEM}`);
    if (targetItem) {
      targetItem.classList.remove('drag-over');
    }
  }

  /**
   * 拖拽放置处理函数
   */
  async handleDrop(e) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const targetItem = e.target.closest(`.${CONFIG.CSS_CLASSES.ITEM}`);
    
    if (targetItem) {
      targetItem.classList.remove('drag-over');
      const targetId = targetItem.dataset.id;
      
      if (draggedId !== targetId && this.pinnedExtensions.indexOf(targetId) !== -1) {
        const oldIndex = this.pinnedExtensions.indexOf(draggedId);
        const newIndex = this.pinnedExtensions.indexOf(targetId);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          // 重新排序数组
          this.pinnedExtensions.splice(oldIndex, 1);
          this.pinnedExtensions.splice(newIndex, 0, draggedId);
          await storage.set({ pinned: this.pinnedExtensions });
          await this.render();
        }
      }
    }
  }

  /**
   * 拖拽结束处理函数
   */
  handleDragEnd(e) {
    if (this.draggedElement) {
      this.draggedElement.classList.remove('dragging');
    }
    this.draggedElement = null;
    const allItems = this.elements.list.querySelectorAll(`.${CONFIG.CSS_CLASSES.ITEM}`);
    allItems.forEach(item => item.classList.remove('drag-over'));
  }
  
  /**
   * 处理启用/禁用切换
   * @param {Event} event - change 事件对象
   * @param {string} id - 扩展ID
   * @param {HTMLElement} itemElement - 列表项元素
   */
  async handleToggle(event, id, itemElement) {
    const isEnabled = event.target.checked;
    logger.info(`用户切换扩展 ${id} 状态为: ${isEnabled}`);
    itemElement.classList.toggle(CONFIG.CSS_CLASSES.ITEM_DISABLED, !isEnabled);
    try {
      await setEnabled(id, isEnabled);
    } catch (error) {
      logger.error(`切换扩展 ${id} 状态失败，正在回滚UI...`, error);
      event.target.checked = !isEnabled;
      itemElement.classList.toggle(CONFIG.CSS_CLASSES.ITEM_DISABLED, isEnabled);
    }
  }

  /**
   * 处理打开选项页
   * @param {string} url - 选项页URL
   */
  handleOptions(url) {
    logger.info(`用户点击打开选项页: ${url}`);
    openOptionsPage(url).catch(err => logger.error('打开选项页失败:', err));
  }

  /**
   * 处理卸载
   * @param {string} id - 扩展ID
   * @param {HTMLElement} itemElement - 列表项元素
   */
  async handleUninstall(id, itemElement) {
    logger.info(`用户点击卸载扩展 ${id}`);
    try {
      await uninstall(id);
      // chrome.management.onUninstalled fires, but let's re-render for simplicity 
      // if user cancels, page remains. if succeeds, onUninstalled listener will handle it.
      // For a more robust UI, we can listen to the onUninstalled event globally.
      // Let's just remove it from the view if uninstall is successful.
      const stillInstalled = await chrome.management.get(id).catch(() => null);
      if (!stillInstalled) {
        logger.info(`卸载 ${id} 成功，从视图中移除。`);
        itemElement.remove();
        this.filterExtensions(); // Re-evaluate empty state
      }
    } catch(error) {
      logger.error(`处理卸载扩展 ${id} 时失败:`, error);
    }
  }
  
  /**
   * 根据搜索框内容过滤扩展
   */
  filterExtensions() {
    const query = this.elements.searchBox.value.toLowerCase().trim();
    logger.debug(`过滤扩展，查询: "${query}"`);
    let visibleCount = 0;
    const allItems = this.elements.list.querySelectorAll(`.${CONFIG.CSS_CLASSES.ITEM}`);
    allItems.forEach(item => {
      const name = item.dataset.name;
      const isVisible = name.includes(query);
      item.classList.toggle(CONFIG.CSS_CLASSES.HIDDEN, !isVisible);
      if (isVisible) {
        visibleCount++;
      }
    });

    this.showEmptyState(visibleCount === 0 && this.allExtensions.length > 0);
    logger.debug(`过滤后可见扩展数: ${visibleCount}`);
  }

  /**
   * 控制加载状态的显示
   * @param {boolean} show - 是否显示
   */
  showLoading(show) {
    this.elements.loadingSpinner.classList.toggle(CONFIG.CSS_CLASSES.HIDDEN, !show);
  }

  /**
   * 控制空状态的显示
   * @param {boolean} show - 是否显示
   */
  showEmptyState(show) {
    this.elements.emptyState.classList.toggle(CONFIG.CSS_CLASSES.HIDDEN, !show);
  }
}

// 当DOM加载完毕后，启动应用
document.addEventListener('DOMContentLoaded', () => {
    const app = new ExtensionManagerApp();
    app.init().catch(err => {
      logger.error("应用启动时发生未捕获的错误:", err);
      // Display a critical error message to the user
      document.body.innerHTML = `<p style="color: red; padding: 20px; text-align: center;">糟糕，应用启动失败！</p>`;
    });
});
