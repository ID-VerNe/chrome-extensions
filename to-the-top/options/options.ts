/**
 * Options page logic.
 *
 * Loads settings from chrome.storage.sync, populates the form,
 * and saves changes on input.
 */

import type { ExtensionSettings } from '../background/background'

// --- DOM refs ---
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const enabledEl = $<HTMLInputElement>('enabled')

const themeModeEl = $<HTMLSelectElement>('themeMode')
const iconStyleEl = $<HTMLSelectElement>('iconStyle')
const opacityEl = $<HTMLInputElement>('opacity')
const opacityValueEl = $<HTMLElement>('opacityValue')
const primaryColorEl = $<HTMLInputElement>('primaryColor')
const injectionModeEl = $<HTMLSelectElement>('injectionMode')

const disabledSitesListEl = $<HTMLElement>('disabledSitesList')
const newSiteInputEl = $<HTMLInputElement>('newSiteInput')
const addSiteBtnEl = $<HTMLButtonElement>('addSiteBtn')

// --- State ---
let settings: ExtensionSettings | null = null
let saving = false

// --- Load ---
async function loadSettings(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
  settings = response as ExtensionSettings
  applySettings(settings)
}

function applySettings(s: ExtensionSettings): void {
  enabledEl.checked = s.enabled
  themeModeEl.value = s.themeMode
  iconStyleEl.value = s.iconStyle
  opacityEl.value = String(s.opacity)
  opacityValueEl.textContent = `${s.opacity}%`
  primaryColorEl.value = s.primaryColor === 'auto' ? '' : s.primaryColor
  injectionModeEl.value = s.injectionMode
  renderDisabledSites(s.disabledSites)
}

function renderDisabledSites(sites: string[]): void {
  disabledSitesListEl.innerHTML = sites
    .map(
      (site) =>
        `<span class="tag" data-site="${site}">
          ${site}
          <span class="tag-remove" data-site="${site}">×</span>
        </span>`,
    )
    .join('')

  // Bind remove events
  disabledSitesListEl.querySelectorAll('.tag-remove').forEach((el) => {
    el.addEventListener('click', () => {
      const site = (el as HTMLElement).dataset.site
      if (site && settings) {
        settings.disabledSites = settings.disabledSites.filter(
          (s) => s !== site,
        )
        queueSave()
      }
    })
  })
}

// --- Save (debounced) ---
let saveTimer: ReturnType<typeof setTimeout> | null = null

function queueSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(), 300)
}

async function save(): Promise<void> {
  if (!settings || saving) return
  saving = true

  settings.enabled = enabledEl.checked
  settings.themeMode = themeModeEl.value as ExtensionSettings['themeMode']
  settings.iconStyle = iconStyleEl.value as ExtensionSettings['iconStyle']
  settings.opacity = Number(opacityEl.value)
  settings.primaryColor = primaryColorEl.value.trim() || 'auto'
  settings.injectionMode =
    injectionModeEl.value as ExtensionSettings['injectionMode']

  await chrome.storage.sync.set({ settings })
  saving = false
}

// --- Events ---
enabledEl.addEventListener('change', queueSave)
themeModeEl.addEventListener('change', queueSave)
iconStyleEl.addEventListener('change', queueSave)
opacityEl.addEventListener('input', () => {
  opacityValueEl.textContent = `${opacityEl.value}%`
})
opacityEl.addEventListener('change', queueSave)
primaryColorEl.addEventListener('change', queueSave)
injectionModeEl.addEventListener('change', queueSave)

addSiteBtnEl.addEventListener('click', () => {
  const site = newSiteInputEl.value.trim()
  if (!site || !settings) return
  if (!settings.disabledSites.includes(site)) {
    settings.disabledSites.push(site)
    queueSave()
  }
  newSiteInputEl.value = ''
})

newSiteInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addSiteBtnEl.click()
})

// --- Boot ---
loadSettings()