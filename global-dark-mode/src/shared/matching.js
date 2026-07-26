// 站点名单匹配：按 origin（协议+域名+端口）精确匹配。
// v0.1 只支持 origin 精确匹配；后续如需 glob/regex 再扩展。

export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function siteDisabled(currentOrigin, disabledSites) {
  if (!currentOrigin) return false;
  return (disabledSites || []).includes(currentOrigin);
}

// 切换某 origin 在名单中的状态，返回新数组。
export function toggleSite(disabledSites, origin, disable) {
  const set = new Set(disabledSites || []);
  if (disable) set.add(origin);
  else set.delete(origin);
  return [...set];
}
