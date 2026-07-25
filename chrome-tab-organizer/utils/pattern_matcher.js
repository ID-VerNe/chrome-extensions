/**
 * @fileoverview pattern_matcher.js - URL Pattern 匹配工具。
 */

import Logger from './logger.js';

const logger = new Logger('PatternMatcher');

/**
 * 检查 URL 是否匹配给定的模式。
 * 支持简单的通配符 `*`，`*` 可以匹配 0 个或多个字符。
 * @param {string} url - 要检查的 URL 字符串。
 * @param {string} pattern - 包含通配符 `*` 的模式字符串。
 * @returns {boolean} 如果 URL 匹配模式则返回 true，否则返回 false。
 */
export function matchesPattern(url, pattern) {
    logger.debug(`正在匹配 URL: "${url}" 与模式: "${pattern}"`);
    if (!url || !pattern) {
        logger.warn('URL 或模式为空，无法匹配。');
        return false;
    }

    // 将模式转换为正则表达式
    // 1. 转义所有特殊正则表达式字符，除了 '*'
    // 2. 将 '*' 替换为 '.*' (匹配任意字符零次或多次)
    // 3. 使用 '^' 和 '$' 确保匹配整个字符串
    const regexPattern = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    try {
        const regex = new RegExp(regexPattern);
        const result = regex.test(url);
        logger.debug(`匹配结果: ${result}`);
        return result;
    } catch (e) {
        logger.error(`创建正则表达式失败或匹配错误: ${e.message}, 模式: ${pattern}`);
        return false;
    }
}

/**
 * 检查 URL 是否匹配模式列表中的任意一个模式。
 * @param {string} url - 要检查的 URL 字符串。
 * @param {string[]} patterns - 包含通配符 `*` 的模式字符串数组。
 * @returns {boolean} 如果 URL 匹配任意一个模式则返回 true，否则返回 false。
 */
export function matchesAnyPattern(url, patterns) {
    logger.debug(`正在匹配 URL: "${url}" 与模式列表:`, patterns);
    if (!url || !Array.isArray(patterns) || patterns.length === 0) {
        logger.debug('模式列表为空或无效，不进行匹配。');
        return false;
    }

    for (const pattern of patterns) {
        if (matchesPattern(url, pattern)) {
            logger.debug(`URL "${url}" 匹配模式 "${pattern}"。`);
            return true;
        }
    }
    logger.debug(`URL "${url}" 未匹配任何模式。`);
    return false;
}
