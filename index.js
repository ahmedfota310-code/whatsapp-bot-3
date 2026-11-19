const { Client, LocalAuth } = require('whatsapp-web.js');
const {
    getGroupSettings,
    updateGroupSetting,
    setAllProtection,
    addLinkWarning,
    resetLinkWarning,
    sendModesPanel
} = require('./settings');

// رقم البوت الافتراضي: 01119815662 -> 201119815662
const BOT_NUMBER = process.env.PHONE_NUMBER || '201119815662';
const PANEL_IMAGE_PATH = process.env.PANEL_IMAGE || null;
const SIGNATURE = 'اللي بينيكك';

const BAD_WORDS = [
    'شرموط', 'خول', 'متناك', 'عرص', 'لبوه', 'منيك', 'وسخ', 'كلب', 'حيوان'
];

const LINK_REGEX = /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|instagram\.com\/|tiktok\.com\/|youtube\.com\/|youtu\.be\/)/i;

const deletedMessagesCache = new Map();

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

async function isGroupAdmin(chat, participantId) {
    if (!chat.isGroup) return false;
    const participant = chat.participants.find((p) => p.id._serialized === participantId);
    return Boolean(participant && (participant.isAdmin || participant.isSuperAdmin));
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
    console.log(`Bot is ready on ${BOT_NUMBER}!`);
});

// استرجاع الرسائل المحذوفة عند تفعيل antiDelete
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

// ترحيب وتوديع الأعضاء عند تفعيل welcomeBye
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

        // الردود الثابتة المطلوبة
        if (bodyLower === '.حمص') {
            await msg.reply('بومه');
            return;
        }
        if (bodyLower === '.بوت') {
            await msg.reply('كسمك');
            return;
        }
        if (bodyLower === '.كسمك') {
            await msg.reply('شكرا');
            return;
        }

        if (chat.isGroup) {
            const settings = getGroupSettings(chat.id._serialized);
            const senderIsAdmin = await isGroupAdmin(chat, senderId);
            const botId = client.info?.wid?._serialized;
            const botIsAdmin = botId ? await isGroupAdmin(chat, botId) : false;

            // منع جهات الاتصال
            if (settings.antiContact && !senderIsAdmin && (msg.type === 'vcard' || msg.type === 'multi_vcard')) {
                await msg.delete(true).catch(() => {});
                await chat.sendMessage(
                    cardBox('منع جهات الاتصال 📇', [
                        `⚠️ ممنوع إرسال جهات اتصال هنا يا *${userLabel}*.`
                    ])
                );
                return;
            }

            // منع الشتائم
            if (settings.antiSwear && !senderIsAdmin && BAD_WORDS.some((w) => bodyLower.includes(w))) {
                await msg.delete(true).catch(() => {});
                await chat.sendMessage(
                    cardBox('منع الشتائم 🤬', [
                        `⚠️ تم حذف الرسالة لاحتوائها على ألفاظ غير لائقة يا *${userLabel}*.`
                    ])
                );
                return;
            }

            // نظام الـ 5 تحذيرات للروابط + طرد تلقائي عند التحذير 5
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

            // عرض لوحة الأوضاع
            if (body === '.الاوضاع' || body === '.الاوامر' || body === '.لوحة') {
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            // تفعيل وإيقاف الحماية بالكامل
            if (body === '.تفعيل الحماية') {
                if (settings.adminMode && !senderIsAdmin) {
                    await msg.reply('❌ هذا الأمر للأدمن فقط.');
                    return;
                }
                setAllProtection(chat.id._serialized, true);
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            if (body === '.ايقاف الحماية') {
                if (settings.adminMode && !senderIsAdmin) {
                    await msg.reply('❌ هذا الأمر للأدمن فقط.');
                    return;
                }
                setAllProtection(chat.id._serialized, false);
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            // التحكم في وضع محدد (.وضع <اسم_الوضع> اون/اوف)
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
                    await msg.reply('❌ هذا الأمر للأدمن فقط.');
                    return;
                }
                const keyName = modeMatch[1].trim();
                const stateVal = modeMatch[2].toLowerCase() === 'اون';
                const targetKey = modeMap[keyName];

                if (!targetKey) {
                    await msg.reply(
                        cardBox('أوضاع متاحة ⚙️', [
                            'الشتائم | البوتات | الروابط | جهات الاتصال',
                            'المحذوف | الترحيب | الادمن | المطور | الخاص',
                            'مثال: *.وضع الروابط اون*'
                        ])
                    );
                    return;
                }

                updateGroupSetting(chat.id._serialized, targetKey, stateVal);
                await sendModesPanel(client, chat.id._serialized, BOT_NUMBER, PANEL_IMAGE_PATH);
                return;
            }

            // أوامر الإشراف (طرد / ترقية) بالمنشن أو الرد على رسالة
            const targetId =
                (msg.mentionedIds && msg.mentionedIds[0]) ||
                (msg.hasQuotedMsg ? (await msg.getQuotedMessage()).author || (await msg.getQuotedMessage()).from : null);

            if (body.startsWith('.طرد')) {
                if (!senderIsAdmin) {
                    await msg.reply('❌ الأمر ده للأدمن فقط.');
                    return;
                }
                if (!botIsAdmin) {
                    await msg.reply('❌ لازم البوت يكون أدمن عشان يقدر يطرد.');
                    return;
                }
                if (!targetId) {
                    await msg.reply('❌ اعمل منشن للشخص أو رد على رسالته مع *.طرد*.');
                    return;
                }
                await chat.removeParticipants([targetId]);
                await chat.sendMessage(
                    cardBox('تم الطرد 👢', [
                        `تم إخراج العضو بنجاح من *${chat.name}*.`
                    ])
                );
                return;
            }

            if (body.startsWith('.ترقيه') || body.startsWith('.ترقية')) {
                if (!senderIsAdmin) {
                    await msg.reply('❌ الأمر ده للأدمن فقط.');
                    return;
                }
                if (!botIsAdmin) {
                    await msg.reply('❌ لازم البوت يكون أدمن عشان يقدر يرقّي.');
                    return;
                }
                if (!targetId) {
                    await msg.reply('❌ اعمل منشن للشخص أو رد على رسالته مع *.ترقيه*.');
                    return;
                }
                await chat.promoteParticipants([targetId]);
                await chat.sendMessage(
                    cardBox('ترقية إشراف 🛡️', [
                        `تمت ترقية العضو ليصبح أدمن في *${chat.name}*.`
                    ])
                );
                return;
            }

            // ألعاب ترفيهية: توافق/زواج ومحكمة
            if (body.startsWith('.توافق') || body.startsWith('.زواج')) {
                const mentions = msg.mentionedIds || [];
                const p1 = mentions[0] ? extractLabel((await client.getContactById(mentions[0]).catch(() => null))?.pushname || '') : userLabel;
                const p2 = mentions[1]
                    ? extractLabel((await client.getContactById(mentions[1]).catch(() => null))?.pushname || '')
                    : 'شريك عشوائي';
                const percent = Math.floor(Math.random() * 61) + 40;
                await chat.sendMessage(
                    cardBox('نسبة التوافق 💘', [
                        `💞 الطرف الأول: *${p1}*`,
                        `💞 الطرف الثاني: *${p2}*`,
                        `📊 النسبة: *${percent}%*`
                    ])
                );
                return;
            }

            if (body.startsWith('.محكمه') || body.startsWith('.محكمة')) {
                const accused = targetId
                    ? extractLabel((await client.getContactById(targetId).catch(() => null))?.pushname || '')
                    : userLabel;
                const verdicts = [
                    'براءة تامة مع الإشادة بالأخلاق ⚖️',
                    'حكم غرامي: يوزع حلويات على الجروب 🍰',
                    'حكم إداري: يغيّر لقبه إلى ~ مطيع القوانين 🛡️',
                    'إيقاف مؤقت عن الفلسفة لمدة ساعتين 😂'
                ];
                const chosen = verdicts[Math.floor(Math.random() * verdicts.length)];
                await chat.sendMessage(
                    cardBox('المحكمة العليا ⚖️', [
                        `👨‍⚖️ المتهم: *${accused}*`,
                        `📜 الحكم: ${chosen}`
                    ])
                );
                return;
            }
        }
    } catch (err) {
        console.error('Message handling error:', err?.message || err);
    }
});

client.initialize();
      
