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
const { Client, LocalAuth } = require('whatsapp-web.js');
const {
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
    sendModesPanel
} = require('./settings');

const BOT_NUMBER = process.env.PHONE_NUMBER || '201119815662';
const OWNER_NUMBER = normalizePhone(process.env.OWNER_NUMBER || BOT_NUMBER);
const PANEL_IMAGE_PATH = process.env.PANEL_IMAGE || null;
const SIGNATURE = 'اللي بينيكك';

const BAD_WORDS = [
    'شرموط', 'خول', 'متناك', 'عرص', 'لبوه', 'منيك', 'وسخ', 'كلب', 'حيوان'
];

const ROAST_TRIGGERS = [
    'كسمك',
    'عرص',
    'عرث',
    'تيز',
    'طيز',
    'يبن الاحبه',
    'يبن مرا متناكه',
    'يبن متناكه',
    'يبن شرموطه',
    'يبن عاهره',
    'امك'
];

const ROAST_REPLIES = [
    'كسمك',
    'يبن الاحبه',
    'يبن مرا متناكه',
    'تعالي اعملي بلوجوب يكسمك 😍'
];

const LINK_REGEX = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|instagram\.com\/|tiktok\.com\/|youtube\.com\/|youtu\.be\/)/i;

const deletedMessagesCache = new Map();
let globalRoastEnabled = true;

function cardBox(title, lines = []) {
    const top = `╭━━━〔 *${title}* 〕━━━╮`;
    const body = lines.map((line) => `┃ ${line}`).join('\n');
    const bottom = `╰━━━✦ *${SIGNATURE}* ✦━━━╯`;
    return `${top}\n${body}\n${bottom}`;
}

function extractLabel(pushnameOrName = '') {
    const tildeMatch = pushnameOrName.match(/~\s*([^\n|•]+)/);
    if (tildeMatch && tildeMatch[1]) return tildeMatch[1].trim();
    return pushnameOrName.trim() || 'مستخدم';
}

function isOwner(senderId) {
    const digits = normalizePhone((senderId || '').split('@')[0]);
    return Boolean(digits && digits === OWNER_NUMBER);
}

async function isGroupAdmin(chat, participantId) {
    if (!chat.isGroup) return false;
    const participant = chat.participants.find((p) => p.id._serialized === participantId);
    return Boolean(participant && (participant.isAdmin || participant.isSuperAdmin));
}

async function reactTo(msg, emoji) {
    try {
        if (msg && typeof msg.react === 'function') {
            await msg.react(emoji);
        }
    } catch {
        // تجاهل خطأ الرياكشن حتى لا يتأثر تنفيذ الأمر
    }
}

async function resolveTargetContact(client, msg, chat, explicitArg = '') {
    const digitsFromArg = normalizePhone(explicitArg);
    if (digitsFromArg) {
        const contact = await client.getContactById(`${digitsFromArg}@c.us`).catch(() => null);
        return {
            id: `${digitsFromArg}@c.us`,
            number: digitsFromArg,
            label: extractLabel(contact?.pushname || contact?.name || digitsFromArg)
        };
    }

    if (msg.mentionedIds && msg.mentionedIds[0]) {
        const targetId = msg.mentionedIds[0];
        const contact = await client.getContactById(targetId).catch(() => null);
        const num = normalizePhone(contact?.number || targetId.split('@')[0]);
        return {
            id: targetId,
            number: num,
            label: extractLabel(contact?.pushname || contact?.name || num)
        };
    }

    if (msg.hasQuotedMsg) {
        const quoted = await msg.getQuotedMessage();
        const qId = quoted.author || quoted.from;
        const contact = await client.getContactById(qId).catch(() => null);
        const num = normalizePhone(contact?.number || qId.split('@')[0]);
        return {
            id: qId,
            number: num,
            label: extractLabel(contact?.pushname || contact?.name || num)
        };
    }

    if (!chat.isGroup) {
        const otherId = msg.from;
        const contact = await client.getContactById(otherId).catch(() => null);
        const num = normalizePhone(contact?.number || otherId.split('@')[0]);
        return {
            id: otherId,
            number: num,
            label: extractLabel(contact?.pushname || contact?.name || num)
        };
    }

    return null;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ]
    }
});

let pairingRequested = false;

client.on('qr', async () => {
    if (pairingRequested) return;
    pairingRequested = true;
    try {
        await new Promise((r) => setTimeout(r, 2000));
        const code = await client.requestPairingCode(BOT_NUMBER);
        console.log(`\nPAIRING CODE (${BOT_NUMBER}): ${code}\n`);
    } catch (err) {
        pairingRequested = false;
        console.error('Pairing code error:', err?.message || err);
    }
});

client.on('ready', () => {
    getAccessConfig(OWNER_NUMBER);
    console.log(`Bot is ready on ${BOT_NUMBER}!`);
});

client.on('message_revoke_everyone', async (afterMsg, beforeMsg) => {
    try {
        const cached = beforeMsg || (afterMsg && afterMsg.id ? deletedMessagesCache.get(afterMsg.id._serialized) : null);
        if (!cached || !cached.from) return;

        const chat = await client.getChatById(cached.from);
        if (!chat.isGroup) return;

        const settings = getGroupSettings(chat.id._serialized);
        if (!settings.antiDelete) return;

        const senderId = cached.author || cached.from;
        const contact = await client.getContactById(senderId).catch(() => null);
        const label = extractLabel(contact?.pushname || contact?.name || '');

        await chat.sendMessage(
            cardBox('استرجاع محذوف ♻️', [
                `👤 العضو: ${label}`,
                `📝 النص المحذوف: ${cached.body || '[ميديا / غير نصي]'}`
            ])
        );
    } catch (err) {
        console.error('Anti-delete error:', err?.message || err);
    }
});

client.on('group_join', async (notification) => {
    try {
        const chat = await notification.getChat();
        const settings = getGroupSettings(chat.id._serialized);
        if (!settings.welcomeBye) return;

        for (const id of notification.recipientIds || []) {
            const contact = await client.getContactById(id).catch(() => null);
            const label = extractLabel(contact?.pushname || contact?.name || '');
            await chat.sendMessage(
                cardBox('ترحيب 👋', [
                    `أهلاً بك يا *${label}* في *${chat.name}*!`,
                    `التزم بالقوانين واستمتع بوقتك.`
                ])
            );
        }
    } catch (err) {
        console.error('Welcome error:', err?.message || err);
    }
});

client.on('group_leave', async (notification) => {
    try {
        const chat = await notification.getChat();
        const settings = getGroupSettings(chat.id._serialized);
        if (!settings.welcomeBye) return;

        for (const id of notification.recipientIds || []) {
            const contact = await client.getContactById(id).catch(() => null);
            const label = extractLabel(contact?.pushname || contact?.name || '');
            await chat.sendMessage(
                cardBox('توديع 👋', [
                    `مع السلامة يا *${label}*، نورت الجروب.`
                ])
            );
        }
    } catch (err) {
        console.error('Goodbye error:', err?.message || err);
    }
});

client.on('message', async (msg) => {
    try {
        if (msg.id && msg.id._serialized) {
            deletedMessagesCache.set(msg.id._serialized, msg);
            if (deletedMessagesCache.size > 500) {
                const firstKey = deletedMessagesCache.keys().next().value;
                deletedMessagesCache.delete(firstKey);
            }
        }

        const chat = await msg.getChat();
        const senderId = msg.author || msg.from;
        const contact = await msg.getContact().catch(() => null);
        const userLabel = extractLabel(contact?.pushname || contact?.name || '');
        const body = (msg.body || '').trim();
        const bodyLower = body.toLowerCase();

        const groupSettings = chat.isGroup ? getGroupSettings(chat.id._serialized) : null;
        const allowed = isUserAllowed(senderId, Boolean(groupSettings && groupSettings.privateMode), OWNER_NUMBER);

        // أوامر الوضع الخاص ومنح الصلاحية بالرقم
        if (body === '.خاص') {
            if (!isOwner(senderId)) {
                await reactTo(msg, '❌');
                return;
            }
            setPrivateGlobal(true, OWNER_NUMBER);
            if (chat.isGroup) updateGroupSetting(chat.id._serialized, 'privateMode', true);
            await reactTo(msg, '☑️');
            await msg.reply(
                cardBox('الوضع الخاص 🔒', [
                    'تم تفعيل الوضع الخاص؛ البوت متاح لك وللأرقام المسموح لها فقط.'
                ])
            );
            return;
        }

        if (body === '.عام') {
            if (!isOwner(senderId)) {
                await reactTo(msg, '❌');
                return;
            }
            setPrivateGlobal(false, OWNER_NUMBER);
            if (chat.isGroup) updateGroupSetting(chat.id._serialized, 'privateMode', false);
            await reactTo(msg, '☑️');
            await msg.reply(
                cardBox('الوضع العام 🌐', [
                    'تم إلغاء الوضع الخاص؛ البوت متاح للجميع.'
                ])
            );
            return;
        }

        const useMatch = body.match(/^\.استخدام(?:\s+(.+))?$/);
        if (useMatch) {
            if (!isOwner(senderId)) {
                await reactTo(msg, '❌');
                return;
            }
            const res = allowNumber(useMatch[1] || '', OWNER_NUMBER);
            if (!res.ok) {
                await reactTo(msg, '❌');
                await msg.reply('❌ اكتب رقم صحيح بعد *.استخدام* مثل: *.استخدام 01012345678*');
                return;
            }
            await reactTo(msg, '☑️');
            await msg.reply(
                cardBox('منح استخدام ✅', [
                    `📱 الرقم: *${res.number}*`,
                    'يمكنه استخدام البوت الآن حتى لو الوضع الخاص مفعل.'
                ])
            );
            return;
        }

        const revokeMatch = body.match(/^\.الغاء(?:\s+(.+))?$/);
        if (revokeMatch) {
            if (!isOwner(senderId)) {
                await reactTo(msg, '❌');
                return;
            }
            const res = revokeNumber(revokeMatch[1] || '', OWNER_NUMBER);
            if (!res.number) {
                await reactTo(msg, '❌');
                return;
            }
            await reactTo(msg, '☑️');
            await msg.reply(
                cardBox('إلغاء استخدام 🚫', [
                    `📱 الرقم: *${res.number}*`,
                    'تمت إزالته من قائمة الاستخدام وقت الوضع الخاص.'
                ])
            );
            return;
        }

        if (!allowed) {
            return;
        }

        // تشغيل وإيقاف وضع الغلط (.اغلط / .اسكت2)
        if (body === '.اغلط') {
            globalRoastEnabled = true;
            if (chat.isGroup) {
                updateGroupSetting(chat.id._serialized, 'roastBack', true);
            }
            await reactTo(msg, '☑️');
            await msg.reply('تم تفعيل وضع الغلط ☑️');
            return;
        }

        if (body === '.اسكت2') {
            globalRoastEnabled = false;
            if (chat.isGroup) {
                updateGroupSetting(chat.id._serialized, 'roastBack', false);
            }
            await reactTo(msg, '☑️');
            await msg.reply('تم إيقاف وضع الغلط ☑️');
            return;
        }

        // الردود الثابتة المطلوبة
        if (bodyLower === '.حمص') {
            await reactTo(msg, '☑️');
            await msg.reply('بومه');
            return;
        }
        if (bodyLower === '.بوت') {
            await reactTo(msg, '☑️');
            await msg.reply('كسمك');
            return;
        }
        if (bodyLower === '.كسمك') {
            await reactTo(msg, '☑️');
            await msg.reply('شكرا');
            return;
        }

        // أمر (.اظهار) في جروب أو شات خاص
        if (body === '.اظهار' || body.startsWith('.اظهار ')) {
            const arg = body.replace(/^\.اظهار\s*/, '').trim();
            const target = await resolveTargetContact(client, msg, chat, arg);
            if (!target || !target.number) {
                await reactTo(msg, '❌');
                await msg.reply('❌ في الجروب اعمل منشن للشخص أو رد على رسالته أو اكتب رقمه مع *.اظهار*.');
                return;
            }
            await reactTo(msg, '☑️');
            await msg.reply(
                cardBox('إظهار الرقم 📱', [
                    `👤 الاسم: *${target.label}*`,
                    `📞 الرقم: *${target.number}*`
                ])
            );
            return;
        }

        // أمر (.ابلاغ <الرقم>) لتسجيل 100 بلاغ متتالي في السجل وعرض البطاقة
        const reportMatch = body.match(/^\.ابلاغ(?:\s+(.+))?$/);
        if (reportMatch) {
            const rawArg = (reportMatch[1] || '').trim();
            const target = await resolveTargetContact(client, msg, chat, rawArg);
            const digitsOnly = normalizePhone(rawArg) || target?.number;

            if (!digitsOnly) {
                await reactTo(msg, '❌');
                await msg.reply('❌ اكتب الرقم جنب الأمر كده: *.ابلاغ 01012345678*');
                return;
            }

            const label = target?.label || digitsOnly;
            const totalReportsToLog = 100;
            let totalReports = 0;

            for (let i = 1; i <= totalReportsToLog; i++) {
                totalReports = logReport({
                    sequence: i,
                    reportedNumber: digitsOnly,
                    reportedLabel: label,
                    byUser: senderId,
                    chatId: chat.id._serialized
                });
                if (i % 25 === 0) {
                    await new Promise((r) => setTimeout(r, 150));
                }
            }

            await reactTo(msg, '☑️');
            await msg.reply(
                cardBox('تسجيل 100 بلاغ 🛡️', [
                    `📞 الرقم: *${digitsOnly}*`,
                    `👤 الاسم: *${label}*`,
                    `🔢 المنفّذ في الدفعة: *${totalReportsToLog} / ${totalReportsToLog}*`,
                    `📁 إجمالي المسجل للرقم: *${totalReports}*`
                ])
            );
            return;
        }

        if (chat.isGroup) {
            const settings = groupSettings;
            const senderIsAdmin = await isGroupAdmin(chat, senderId);
            const botId = client.info?.wid?._serialized;
            const botIsAdmin = botId ? await isGroupAdmin(chat, botId) : false;

            if (settings.antiContact && !senderIsAdmin && (msg.type === 'vcard' || msg.type === 'multi_vcard')) {
                await msg.delete(true).catch(() => {});
                await chat.sendMessage(
                    cardBox('منع جهات الاتصال 📇', [
                        `⚠️ ممنوع إرسال جهات اتصال هنا يا *${userLabel}*.`
                    ])
                );
                return;
            }

            if (settings.antiSwear && !senderIsAdmin && BAD_WORDS.some((w) => bodyLower.includes(w))) {
                await msg.delete(true).catch(() => {});
                await chat.sendMessage(
                    cardBox('منع الشتائم 🤬', [
                        `⚠️ تم حذف الرسالة لاحتوائها على ألفاظ غير لائقة يا *${userLabel}*.`
                    ])
                );
                return;
            }

            if (settings.antiLink && !senderIsAdmin && LINK_REGEX.test(body)) {
                await msg.delete(true).catch(() => {});
                const warnCount = addLinkWarning(chat.id._serialized, senderId);

                if (warnCount >= 5) {
                    resetLinkWarning(chat.id._serialized, senderId);
                    if (botIsAdmin) {
                        await chat.removeParticipants([senderId]).catch(() => {});
                        await chat.sendMessage(
                            cardBox('طرد تلقائي 🚫', [
                                `👤 العضو: *${userLabel}*`,
                                `🔗 السبب: تجاوز الحد الأقصى لتحذيرات الروابط (5/5).`
                            ])
                        );
                    } else {
                        await chat.sendMessage(
                            cardBox('تحذير 5/5 🔗', [
                                `👤 العضو: *${userLabel}* وصل لـ 5/5 تحذيرات، ارفع البوت أدمن للطرد التلقائي.`
                            ])
                        );
                    }
                } else {
                    await chat.sendMessage(
                        cardBox('تحذير روابط 🔗', [
                            `👤 العضو: *${userLabel}*`,
                            `⚠️ ممنوع إرسال الروابط في الجروب.`,
                            `📊 التحذير: *${warnCount} من 5*`
                        ])
                    );
                }
                return;
            }

            if (body === '.الاوضاع' || body === '.الاوامر' || body === '.لوحة') {
                await reactTo(msg, '☑️');
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            if (body === '.تفعيل الحماية') {
                if (settings.adminMode && !senderIsAdmin) {
                    await reactTo(msg, '❌');
                    await msg.reply('❌ هذا الأمر للأدمن فقط.');
                    return;
                }
                setAllProtection(chat.id._serialized, true);
                await reactTo(msg, '☑️');
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            if (body === '.ايقاف الحماية') {
                if (settings.adminMode && !senderIsAdmin) {
                    await reactTo(msg, '❌');
                    await msg.reply('❌ هذا الأمر للأدمن فقط.');
                    return;
                }
                setAllProtection(chat.id._serialized, false);
                await reactTo(msg, '☑️');
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            const modeMap = {
                'الشتائم': 'antiSwear',
                'البوتات': 'antiBot',
                'الروابط': 'antiLink',
                'جهات الاتصال': 'antiContact',
                'المحذوف': 'antiDelete',
                'الترحيب': 'welcomeBye',
                'الادمن': 'adminMode',
                'المطور': 'devMode',
                'الخاص': 'privateMode'
            };

            const modeMatch = body.match(/^\.وضع\s+(.+?)\s+(اون|اوف)$/i);
            if (modeMatch) {
                if (settings.adminMode && !senderIsAdmin) {
                    await reactTo(msg, '❌');
                    await msg.reply('❌ هذا الأمر للأدمن فقط.');
                    return;
                }
                const keyName = modeMatch[1].trim();
                const stateVal = modeMatch[2].toLowerCase() === 'اون';
                const targetKey = modeMap[keyName];

                if (!targetKey) {
                    await reactTo(msg, '❌');
                    await msg.reply(
                        cardBox('أوضاع متاحة ⚙️', [
                            'الشتائم | البوتات | الروابط | جهات الاتصال',
                            'المحذوف | الترحيب | الادمن | المطور | الخاص',
                            'مثال: *.وضع الروابط اون*'
                        ])
                    );
                    return;
                }

                if (targetKey === 'privateMode') {
                    setPrivateGlobal(stateVal, OWNER_NUMBER);
                }
                updateGroupSetting(chat.id._serialized, targetKey, stateVal);
                await reactTo(msg, '☑️');
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
          
