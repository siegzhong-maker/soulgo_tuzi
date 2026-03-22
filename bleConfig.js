/**
 * BLE GATT 常量（与 esp_gps_blue/esp_gps_blue/server.js 保持一致）
 * 震动：普通/优质（C、B）-> VIB:1 短震；隐藏/传说（A、S）-> VIB:2 长震（与对接文档一致）
 */
(function (global) {
  global.ESP32_BLE_CONFIG = {
    DEVICE_NAME: 'ESP32-C3-Tracker',
    SERVICE_UUID: '12345678-1234-1234-1234-123456789abc',
    CHAR_TX_UUID: '12345678-1234-1234-1234-123456789abd',
    CHAR_RX_UUID: '12345678-1234-1234-1234-123456789abe',
    /** 打卡掉落 tier -> handleCommand VIB mode（1=短震 2=长震） */
    TIER_TO_VIB: { C: 1, B: 1, A: 2, S: 2 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
