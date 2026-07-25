'use strict';

const CONFIG = {
  ELEMENT_IDS: {
    APP_CONTAINER: 'app',
    SEARCH_BOX: 'search-box',
    EXTENSION_LIST: 'extension-list',
    ITEM_TEMPLATE: 'extension-item-template',
    LOADING_SPINNER: 'loading-spinner',
    EMPTY_STATE: 'empty-state'
  },
  CSS_CLASSES: {
    ITEM: 'extension-item',
    ITEM_DISABLED: 'disabled',
    ICON: 'extension-icon',
    INFO: 'extension-info',
    NAME: 'extension-name',
    VERSION: 'extension-version',
    ACTIONS: 'extension-actions',
    OPTIONS_BTN: 'options-btn',
    UNINSTALL_BTN: 'uninstall-btn',
    PIN_BTN: 'pin-btn',
    PINNED: 'pinned',
    TOGGLE_SWITCH: 'toggle-switch',
    TOGGLE_INPUT: 'toggle-input',
    HIDDEN: 'hidden',
  },
  DEFAULT_ICON_URL: 'icons/icon_48.png', // A default icon if one is not found
};

export default CONFIG;
