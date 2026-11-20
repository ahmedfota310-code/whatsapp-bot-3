const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

const SETTINGS_FILE = path.join(__dirname, 'groupSettings.json');
const WARNS_FILE = path.join(__dirname, 'linkWarns.json');
const ACCESS_FILE = path.join(__dirname, 'accessControl.json');
const REPORTS_FILE = path.join(__dirname, 'reports.json');

const DEFAULT_SETTINGS = {
    antiSwear: false,
    antiBot: false,
    antiLink: true,
    antiContact: false,
    antiDelete: false,
    welcomeBye: false,
    roastBack: true,
    adminMode: true,
    devMode: true,
    privateMode: true
};

function ensureFile(filePath, defaultContent) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
    }
}

function loadJson(filePath, fallback = {}) {
    ensureFile(filePath, fallback);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return { ...fallback };
    }
}

function saveJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizePhone(raw = '') {
    let digits = String(raw).replace(/\D/g, '');
    if (digits.startsWith('01') && digits.length === 11) {
        digits = '20' + digits.slice(1);
    } else if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }
    return digits;
}

function getAccessConfig(defaultOwnerNumber = '201119815662') {
    const data = loadJson(ACCESS_FILE, {
        owner: normalizePhone(defaultOwnerNumber),
        privateGlobal: false,
        allowedNumbers: []
    });
    data.owner = normalizePhone(data.owner || defaultOwnerNumber);
    data.allowedNumbers = Array.isArray(data.allowedNumbers)
        ? data.allowedNumbers.map(normalizePhone).filter(Boolean)
        : [];
    return data;
}

function setPrivateGlobal(enabled, defaultOwnerNumber = '201119815662') {
    const cfg = getAccessConfig(defaultOwnerNumber);
    cfg.privateGlobal = Boolean(enabled);
    saveJson(ACCESS_FILE, cfg);
    return cfg;
}

function allowNumber(rawNumber, defaultOwnerNumber = '201119815662') {
    const cfg = getAccessConfig(defaultOwnerNumber);
    const clean = normalizePhone(rawNumber);
    if (!clean) return { ok: false, cfg };
    if (!cfg.allowedNumbers.includes(clean)) {
        cfg.allowedNumbers.push(clean);
        saveJson(ACCESS_FILE, cfg);
    }
    return { ok: true, number: clean, cfg };
}

function revokeNumber(rawNumber, defaultOwnerNumber = '201119815662') {
    const cfg = getAccessConfig(defaultOwnerNumber);
    const clean = normalizePhone(rawNumber);
    cfg.allowedNumbers = cfg.allowedNumbers.filter((n) => n !== clean);
    saveJson(ACCESS_FILE, cfg);
    return { ok: true, number: clean, cfg };
}

function isUserAllowed(senderId, groupPrivateMode = false, defaultOwnerNumber = '201119815662') {
    const cfg = getAccessConfig(defaultOwnerNumber);
    const senderDigits = normalizePhone((senderId || '').split('@')[0]);
    if (senderDigits && senderDigits === cfg.owner) return true;

    const isPrivateActive = Boolean(cfg.privateGlobal || groupPrivateMode);
    if (!isPrivateActive) return true;

    return Boolean(senderDigits && cfg.allowedNumbers.includes(senderDigits));
}

function logReport(entry) {
    const list = loadJson(REPORTS_FILE, []);
    list.push({
        ...entry,
        createdAt: new Date().toISOString()
    });
    saveJson(REPORTS_FILE, list);
    return list.length;
}

function getGroupSettings(groupId) {
    const all = loadJson(SETTINGS_FILE, {});
    if (!all[groupId]) {
        all[groupId] = { ...DEFAULT_SETTINGS };
        saveJson(SETTINGS_FILE, all);
    }
    return { ...DEFAULT_SETTINGS, ...all[groupId] };
}

function updateGroupSetting(groupId, key, value) {
    const all = loadJson(SETTINGS_FILE, {});
    if (!all[groupId]) all[groupId] = { ...DEFAULT_SETTINGS };
    all[groupId][key] = Boolean(value);
    saveJson(SETTINGS_FILE, all);
    return all[groupId];
}

function setAllProtection(groupId, enabled) {
    const all = loadJson(SETTINGS_FILE, {});
    if (!all[groupId]) all[groupId] = { ...DEFAULT_SETTINGS };
    const state = Boolean(enabled);
    all[groupId].antiSwear = state;
    all[groupId].antiBot = state;
    all[groupId].antiLink = state;
    all[groupId].antiContact = state;
    saveJson(SETTINGS_FILE, all);
    return all[groupId];
}

function addLinkWarning(groupId, userId) {
    const warns = loadJson(WARNS_FILE, {});
    if (!warns[groupId]) warns[groupId] = {};
    const current = (warns[groupId][userId] || 0) + 1;
    warns[groupId][userId] = current;
    saveJson(WARNS_FILE, warns);
    return current;
}

function resetLinkWarning(groupId, userId) {
    const warns = loadJson(WARNS_FILE, {});
    if (warns[groupId] && warns[groupId][userId]) {
        delete warns[groupId][userId];
        saveJson(WARNS_FILE, warns);
    }
}

function statusText(val) {
    return val ? 'مفعل ✅' : 'متوقف ❌';
}

function buildModesPanel(groupId, botNumber, botRole = 'فرعي', botTitle = '❄️ ЂӨKі ᵝӨЂ ❄️') {
    const s = getGroupSettings(groupId);
    const cfg = getAccessConfig(botNumber);
    const privateState = Boolean(cfg.privateGlobal || s.privateMode);
    const divider = '❖━━━✦❘༻༺❘✦━━━❖';

    return [
        `⚙️ *لوحة الأوضاع*`,
        `${botTitle}`,
        divider,
        `┃ = ── ⋅ ⚙️ : لوحة الأوضاع`,
        `┃ = ── ⋅ 📍 : المكان ↚ جروب`,
        `┃ = ── ⋅ 🤖 : البوت ↚ ${botRole}`,
        `┃        *${botNumber}*`,
        divider,
        `┃ = ── ⋅ 📌 : ${s.antiSwear ? 'تم تفعيل منع الشتائم' : 'تم إيقاف منع الشتائم'} 🔔`,
        `┃ = ── ⋅ 📌 : ${s.antiBot ? 'تم تفعيل منع البوتات' : 'تم إيقاف منع البوتات'} 🔔`,
        `┃ = ── ⋅ 📌 : ${s.antiLink ? 'تم تفعيل منع الروابط' : 'تم إيقاف منع الروابط'} 🔔`,
        `┃ = ── ⋅ 📌 : ${s.antiContact ? 'تم تفعيل منع جهات الاتصال' : 'تم إيقاف منع جهات الاتصال'} 🔔`,
        `┃ = ── ⋅ 🤬 : منع الشتائم ↚ ${statusText(s.antiSwear)}`,
        `┃ = ── ⋅ 🤖 : منع البوتات ↚ ${statusText(s.antiBot)}`,
        `┃ = ── ⋅ 🔗 : منع الروابط ↚ ${statusText(s.antiLink)}`,
        `┃ = ── ⋅ 📇 : منع جهات الاتصال ↚ ${statusText(s.antiContact)}`,
        `┃ = ── ⋅ ♻️ : استرجاع المحذوف ↚ ${statusText(s.antiDelete)}`,
        `┃ = ── ⋅ 👋 : الترحيب والتوديع ↚ ${statusText(s.welcomeBye)}`,
        `┃ = ── ⋅ 🛡️ : وضع الأدمن ↚ ${statusText(s.adminMode)}`,
        `┃ = ── ⋅ 👑 : وضع المطور ↚ ${statusText(s.devMode)}`,
        `┃ = ── ⋅ 🔒 : الوضع الخاص ↚ ${statusText(privateState)}`,
        divider,
        `┃ = ── ⋅ 📌 : استخدم أوامر الأوضاع أو الحماية`,
        `┃ = ── ⋅ 🔒 : الإعدادات خاصة بالجروب ده`
    ].join('\n');
}

async function sendModesPanel(client, chatId, botNumber, imagePath = null) {
    const caption = buildModesPanel(chatId, botNumber);
    if (imagePath && fs.existsSync(imagePath)) {
        const media = MessageMedia.fromFilePath(imagePath);
        await client.sendMessage(chatId, media, { caption });
    } else {
        await client.sendMessage(chatId, caption);
    }
}

module.exports = {
    normalizePhone,
    getAccessConfig,
    setPrivateGlobal,
    allowNumber,
    revokeNumber,
    isUserAllowed,
    logReport,
    getGroupSettings,
    updateGroupSetting,
    setAllProtection,
    addLinkWarning,
    resetLinkWarning,
    buildModesPanel,
    sendModesPanel
};
  
