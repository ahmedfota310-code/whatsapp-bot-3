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
    } catch {}
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
            }

            const targetId =
                (msg.mentionedIds && msg.mentionedIds[0]) ||
                (msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author || (await msg.getQuotedMessage()).from : null);

            if (body.startsWith('.طرد')) {
                if (!senderIsAdmin) {
                 
