/**
 * @fileoverview options.js - 处理 Chrome Tab Organizer 扩展程序的设置页面逻辑。
 * 负责加载、显示和保存用户配置。
 */

import Logger from './utils/logger.js';
import { configManager } from './utils/config.js';

const logger = new Logger('OptionsPage');

// DOM 元素引用
const classificationTypeSelect = document.getElementById('classificationType');
const customGroupsList = document.getElementById('customGroupsList');
const newCustomGroupPatternInput = document.getElementById('newCustomGroupPattern');
const newCustomGroupNameInput = document.getElementById('newCustomGroupName');
const addCustomGroupButton = document.getElementById('addCustomGroup');
const blacklistList = document.getElementById('blacklistList');
const newBlacklistPatternInput = document.getElementById('newBlacklistPattern');
const addBlacklistButton = document.getElementById('addBlacklist');
const saveSettingsButton = document.getElementById('saveSettings');
const statusMessageDiv = document.getElementById('statusMessage');

/**
 * 显示状态消息。
 * @param {string} message - 要显示的消息。
 * @param {boolean} isError - 是否为错误消息。
 */
function showStatusMessage(message, isError = false) {
    statusMessageDiv.textContent = message;
    statusMessageDiv.style.color = isError ? '#dc3545' : '#28a745';
    statusMessageDiv.style.display = 'block';
    setTimeout(() => {
        statusMessageDiv.style.display = 'none';
    }, 3000); // 3秒后隐藏
}

/**
 * 渲染自定义分组列表。
 * @param {Array<{ pattern: string, groupName: string }>} customGroups - 自定义分组数组。
 */
function renderCustomGroups(customGroups) {
    customGroupsList.innerHTML = '';
    if (customGroups.length === 0) {
        customGroupsList.innerHTML = '<p>暂无自定义分组规则。</p>';
        return;
    }
    customGroups.forEach((group, index) => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        div.innerHTML = `
            <span>模式: <strong>${group.pattern}</strong>, 分组: <strong>${group.groupName}</strong></span>
            <button class="remove-button" data-index="${index}" data-type="customGroup">删除</button>
        `;
        customGroupsList.appendChild(div);
    });
}

/**
 * 渲染黑名单列表。
 * @param {string[]} blacklist - 黑名单 URL 模式数组。
 */
function renderBlacklist(blacklist) {
    blacklistList.innerHTML = '';
    if (blacklist.length === 0) {
        blacklistList.innerHTML = '<p>暂无黑名单规则。</p>';
        return;
    }
    blacklist.forEach((pattern, index) => {
        const div = document.createElement('div');
        div.className = 'rule-item';
        div.innerHTML = `
            <span>模式: <strong>${pattern}</strong></span>
            <button class="remove-button" data-index="${index}" data-type="blacklist">删除</button>
        `;
        blacklistList.appendChild(div);
    });
}

/**
 * 从存储加载配置并更新 UI。
 */
async function loadAndDisplayConfig() {
    logger.info('正在加载并显示配置...');
    try {
        const config = await configManager.getConfig();
        classificationTypeSelect.value = config.classificationType;
        renderCustomGroups(config.customGroups);
        renderBlacklist(config.blacklist);
        logger.info('配置加载并显示成功。');
    } catch (error) {
        logger.error('加载并显示配置失败:', error);
        showStatusMessage('加载配置失败！', true);
    }
}

/**
 * 保存当前 UI 中的配置到存储。
 */
async function saveSettings() {
    logger.info('正在保存设置...');
    const newConfig = {
        classificationType: classificationTypeSelect.value,
        customGroups: [],
        blacklist: []
    };

    // 从 UI 收集自定义分组
    customGroupsList.querySelectorAll('.rule-item').forEach(item => {
        const pattern = item.querySelector('strong:nth-of-type(1)').textContent;
        const groupName = item.querySelector('strong:nth-of-type(2)').textContent;
        newConfig.customGroups.push({ pattern, groupName });
    });

    // 从 UI 收集黑名单
    blacklistList.querySelectorAll('.rule-item').forEach(item => {
        const pattern = item.querySelector('strong').textContent;
        newConfig.blacklist.push(pattern);
    });

    try {
        await configManager.saveConfig(newConfig);
        showStatusMessage('设置已保存！');
        logger.info('设置保存成功。');
        // 保存后可以考虑通知 background script 重新加载配置或触发全量分类
        chrome.runtime.sendMessage({ action: 'runFullClassification' });
    } catch (error) {
        logger.error('保存设置失败:', error);
        showStatusMessage('保存设置失败！', true);
    }
}

/**
 * 添加自定义分组规则。
 */
function addCustomGroup() {
    const pattern = newCustomGroupPatternInput.value.trim();
    const groupName = newCustomGroupNameInput.value.trim();

    if (!pattern || !groupName) {
        showStatusMessage('模式和分组名称不能为空！', true);
        return;
    }

    configManager.getConfig().then(config => {
        const updatedCustomGroups = [...config.customGroups, { pattern, groupName }];
        renderCustomGroups(updatedCustomGroups);
        newCustomGroupPatternInput.value = '';
        newCustomGroupNameInput.value = '';
        showStatusMessage('自定义分组已添加，请点击保存设置。');
    });
}

/**
 * 添加黑名单规则。
 */
function addBlacklist() {
    const pattern = newBlacklistPatternInput.value.trim();

    if (!pattern) {
        showStatusMessage('黑名单模式不能为空！', true);
        return;
    }

    configManager.getConfig().then(config => {
        const updatedBlacklist = [...config.blacklist, pattern];
        renderBlacklist(updatedBlacklist);
        newBlacklistPatternInput.value = '';
        showStatusMessage('黑名单已添加，请点击保存设置。');
    });
}

/**
 * 处理删除规则的点击事件。
 * @param {Event} event - 点击事件对象。
 */
function handleRemoveRule(event) {
    if (event.target.classList.contains('remove-button')) {
        const index = parseInt(event.target.dataset.index);
        const type = event.target.dataset.type;

        configManager.getConfig().then(config => {
            if (type === 'customGroup') {
                const updatedCustomGroups = config.customGroups.filter((_, i) => i !== index);
                renderCustomGroups(updatedCustomGroups);
                showStatusMessage('自定义分组已删除，请点击保存设置。');
            } else if (type === 'blacklist') {
                const updatedBlacklist = config.blacklist.filter((_, i) => i !== index);
                renderBlacklist(updatedBlacklist);
                showStatusMessage('黑名单已删除，请点击保存设置。');
            }
        });
    }
}

// 注册事件监听器
document.addEventListener('DOMContentLoaded', loadAndDisplayConfig);
saveSettingsButton.addEventListener('click', saveSettings);
addCustomGroupButton.addEventListener('click', addCustomGroup);
addBlacklistButton.addEventListener('click', addBlacklist);
customGroupsList.addEventListener('click', handleRemoveRule);
blacklistList.addEventListener('click', handleRemoveRule);
