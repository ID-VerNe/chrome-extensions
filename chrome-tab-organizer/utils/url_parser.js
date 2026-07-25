/**
 * @fileoverview url_parser.js - URL 解析工具，提取 Hostname, TLD 或特殊标识符。
 */

import Logger from './logger.js';

const logger = new Logger('URLParser');

/**
 * 获取 URL 的顶级域名 (TLD)。
 * 这是一个简化的实现，对于生产环境可能需要更健壮的库。
 * @param {string} hostname - URL 的主机名。
 * @returns {string} 顶级域名 (例如: "com", "org.uk")。
 */
function getTld(hostname) {
    const parts = hostname.split('.');
    if (parts.length < 2) {
        return hostname; // 无法解析 TLD，返回整个主机名
    }
    // 简单地取最后两部分作为 TLD，例如 "google.com" -> "google.com"
    // 更复杂的 TLD (如 .co.uk) 需要公共后缀列表
    if (parts.length >= 2) {
        return parts.slice(-2).join('.');
    }
    return parts[parts.length - 1];
}

/**
 * 根据分类类型获取 URL 的站点标识符。
 * 对于特殊 URL (如 chrome://, file://, data:)，返回 scheme + path/identifier。
 * @param {string} urlString - 完整的 URL 字符串。
 * @param {'hostname'|'tld'} classificationType - 分类类型，'hostname' 或 'tld'。
 * @returns {string|null} 站点的唯一标识符，如果 URL 无效则返回 null。
 */
export function getSiteIdentifier(urlString, classificationType) {
    logger.debug(`正在解析 URL: ${urlString}, 分类类型: ${classificationType}`);
    try {
        const url = new URL(urlString);

        // 处理特殊协议
        if (['chrome:', 'file:', 'data:'].includes(url.protocol)) {
            // 对于 chrome://newtab/ 等，使用 scheme + hostname + pathname
            // 对于 file:///C:/path/to/file.html，使用 scheme + pathname
            // 对于 data:image/png;base64,...，使用 scheme + mimeType
            let identifier = url.protocol;
            if (url.hostname) { // 例如 chrome://extensions/
                identifier += `//${url.hostname}`;
            }
            if (url.pathname && url.pathname !== '/') { // 例如 chrome://newtab/
                identifier += url.pathname;
            }
            // 对于 data: URL，通常其内容是唯一的，但为了分类，可以考虑其MIME类型
            if (url.protocol === 'data:') {
                const mimeTypeMatch = url.pathname.match(/^([^;,\/]+(?:\/[^;,\/]+)?)/);
                if (mimeTypeMatch) {
                    identifier += mimeTypeMatch[1]; // 例如 data:image/png
                }
            }
            logger.debug(`特殊 URL 标识符: ${identifier}`);
            return identifier;
        }

        // 处理标准 HTTP/HTTPS URL
        if (url.hostname) {
            if (classificationType === 'hostname') {
                logger.debug(`Hostname 标识符: ${url.hostname}`);
                return url.hostname;
            } else if (classificationType === 'tld') {
                const tld = getTld(url.hostname);
                logger.debug(`TLD 标识符: ${tld}`);
                return tld;
            }
        }
        logger.warn(`无法为 URL 获取有效标识符: ${urlString}`);
        return null;
    } catch (e) {
        logger.error(`解析 URL 失败: ${urlString}, 错误: ${e.message}`);
        return null;
    }
}
