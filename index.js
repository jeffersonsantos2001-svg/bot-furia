require('dotenv').config();
const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const CONFIG = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  channels: {
    setagem: process.env.CADASTRO_CHANNEL_ID,
    logs: process.env.HISTORICO_CHANNEL_ID,
    ranking: process.env.RANKING_CHANNEL_ID || '',
  },

  assets: {
    banner: process.env.PANEL_BANNER_URL || '',
    logo: process.env.PANEL_LOGO_URL || '',
  },

  roles: {
    emSetagem: process.env.EM_SETAGEM_ROLE_ID || '',
    membro: process.env.MEMBRO_ROLE_ID || '',
    gerencia: process.env.GERENCIA_ROLE_ID || '',
    recruiterRoleNames: [
        '[⚙️ Em Setagem]',
      '「Gerência・FURIA」',
      '[LIDER.00] Gustavo',
      '「REC」・FURIA」',
      '「LIDER. FURIA」',
    ],
  },

  minAge: 12,
  maxAge: 99,
  panelCustomId: 'abrir_setagem',
};

const DB_PATH = path.join(__dirname, 'database.json');

function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-');
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return `${monthNames[Number(month) - 1]} de ${year}`;
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      pendentes: {},
      recrutamentos: [],
      rankingMessageId: null,
      monthlyArchiveMessageIds: {},
      lastArchiveCheckMonth: getCurrentMonthKey(),
      panelMessageId: null,
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    parsed.pendentes ??= {};
    parsed.recrutamentos ??= [];
    parsed.rankingMessageId ??= null;
    parsed.monthlyArchiveMessageIds ??= {};
    parsed.lastArchiveCheckMonth ??= getCurrentMonthKey();
    parsed.panelMessageId ??= null;
    return parsed;
  } catch {
    const fallback = {
      pendentes: {},
      recrutamentos: [],
      rankingMessageId: null,
      monthlyArchiveMessageIds: {},
      lastArchiveCheckMonth: getCurrentMonthKey(),
      panelMessageId: null,
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

const db = loadDb();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message],
});

function log(message) {
  console.log(`[${new Date().toLocaleString('pt-BR')}] ${message}`);
}

function normalizeText(text, maxLength = 100) {
  return String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeNicknamePart(text, maxLength = 24) {
  return normalizeText(text, maxLength).replace(/[[\]]/g, '').trim();
}

function buildMemberNickname(nome, idJogo) {
  const cleanName = sanitizeNicknamePart(nome, 18);
  const cleanId = sanitizeNicknamePart(idJogo, 10);
  return `[MB] ${cleanName} [${cleanId}]`.slice(0, 32);
}

function getRecruiterRoleNames() {
  return CONFIG.roles.recruiterRoleNames || [];
}

function hasApprovalRole(member) {
  return (
    member.roles.cache.has(CONFIG.roles.rec) || // 🔥 ESSENCIAL
    member.roles.cache.has(CONFIG.roles.gerencia) ||
    member.roles.cache.has(CONFIG.roles.emSetagem) ||
    member.roles.cache.some(role =>
      CONFIG.roles.recruiterRoleNames.includes(role.name.trim())
    )
  );
}

function isManager(member) {
  return CONFIG.roles.gerencia && member.roles.cache.has(CONFIG.roles.gerencia);
}

function isDirectImageUrl(url) {
  if (!url) return false;
  return /^https?:\/\/.+\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i.test(url.trim());
}

function applyPremiumBranding(embed) {
  if (isDirectImageUrl(CONFIG.assets.logo)) {
    embed.setThumbnail(CONFIG.assets.logo.trim());
  }
  if (isDirectImageUrl(CONFIG.assets.banner)) {
    embed.setImage(CONFIG.assets.banner.trim());
  }
  return embed;
}

function extractNameAndGameIdFromHistory(history = []) {
  const joinedText = history.map((msg) => msg.content || '').join('\n');

  let foundName = null;
  let foundId = null;

  const namePattern = /nome\s*[:\-]\s*(.+)/i;
  const idPattern = /id\s*(?:do jogo|jogo)?\s*[:\-]\s*(\d{4,})/i;

  for (const line of joinedText.split('\n')) {
    const cleanLine = line.trim();

    if (!foundName) {
      const matchName = cleanLine.match(namePattern);
      if (matchName?.[1]) {
        foundName = normalizeText(matchName[1], 40);
      }
    }

    if (!foundId) {
      const matchId = cleanLine.match(idPattern);
      if (matchId?.[1]) {
        foundId = normalizeText(matchId[1], 30);
      }
    }
  }

  if (!foundId) {
    for (const line of joinedText.split('\n')) {
      const match = line.match(/\b\d{5,}\b/);
      if (match) {
        foundId = match[0];
        break;
      }
    }
  }

  return { nome: foundName, idJogo: foundId };
}

async function validateResources(guild) {
  await guild.roles.fetch();

  const emSetagemRole = guild.roles.cache.get(CONFIG.roles.emSetagem) || null;
  const membroRole = guild.roles.cache.get(CONFIG.roles.membro) || null;
  const gerenciaRole = guild.roles.cache.get(CONFIG.roles.gerencia) || null;

  const recruiterRoles = guild.roles.cache.filter((role) =>
    getRecruiterRoleNames().includes(role.name)
  );

  const setagemChannel = await guild.channels.fetch(CONFIG.channels.setagem).catch(() => null);
  const logsChannel = await guild.channels.fetch(CONFIG.channels.logs).catch(() => null);
  const rankingChannel = CONFIG.channels.ranking
    ? await guild.channels.fetch(CONFIG.channels.ranking).catch(() => null)
    : null;

  const missing = [];

  if (!emSetagemRole) missing.push('Cargo Em Setagem');
  if (!membroRole) missing.push('Cargo MEMBRO - FURIA');
  if (!gerenciaRole) missing.push('Cargo Gerência');
  if (!recruiterRoles.size) missing.push('Nenhum cargo de recrutador/liderança encontrado');
  if (!setagemChannel) missing.push('Canal setagem');
  if (!logsChannel) missing.push('Canal logs');
  if (CONFIG.channels.ranking && !rankingChannel) missing.push('Canal ranking');

  return {
    ok: missing.length === 0,
    missing,
    emSetagemRole,
    membroRole,
    gerenciaRole,
    recruiterRoles,
    setagemChannel,
    logsChannel,
    rankingChannel,
  };
}

async function getRecruiterMembers(guild) {
  await guild.roles.fetch();
  await guild.members.fetch();

  const recruiters = guild.members.cache
    .filter((member) => {
      if (member.user.bot) return false;
      return member.roles.cache.some((role) => getRecruiterRoleNames().includes(role.name));
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));

  return [...recruiters.values()];
}

function buildMainPanelEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('🔥 Painel • FURIA')
    .setDescription(
      [
        'Seja bem-vindo à organização.',
        '',
        'Clique no botão abaixo para iniciar sua setagem.',
        '',
        '**Etapas do processo:**',
        '• Informar nome',
        '• Informar ID no jogo',
        '• Informar idade',
        '• Selecionar o recrutador',
      ].join('\n')
    )
    .setColor(0x8e44ad)
    .setFooter({ text: 'FURIA • Painel' })
    .setTimestamp();

  return applyPremiumBranding(embed);
}

function buildMainPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CONFIG.panelCustomId)
        .setLabel('Iniciar Setagem')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋')
    ),
  ];
}

function buildRecruiterPanelEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('👑 Selecione quem recrutou você')
    .setDescription('Escolha abaixo o responsável pelo seu recrutamento.')
    .setColor(0x9b59b6)
    .setFooter({ text: 'FURIA • Seleção de recrutador' })
    .setTimestamp();

  return applyPremiumBranding(embed);
}

function buildApprovalButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`aprovar_rec|${userId}`)
        .setLabel('Aprovar')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`reprovar_rec|${userId}`)
        .setLabel('Reprovar')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
    ),
  ];
}

function buildLogEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle('📥 Novo recrutamento pendente')
    .setColor(0xf1c40f)
    .addFields(
      { name: 'Membro', value: `<@${data.userId}>`, inline: false },
      { name: 'Nome', value: data.nome, inline: true },
      { name: 'ID no jogo', value: data.idJogo, inline: true },
      { name: 'Idade', value: String(data.idade), inline: true },
      { name: 'Recrutador', value: `<@${data.recrutadorId}>`, inline: false }
    )
    .setFooter({ text: `User ID: ${data.userId}` })
    .setTimestamp();

  return applyPremiumBranding(embed);
}

function buildApprovedEmbed(data, approverTag) {
  const embed = new EmbedBuilder()
    .setTitle('✅ Recrutamento aprovado')
    .setColor(0x2ecc71)
    .setDescription(`Seu recrutamento foi aprovado por **${approverTag}**.`)
    .addFields(
      { name: 'Nome', value: data.nome, inline: true },
      { name: 'ID no jogo', value: data.idJogo, inline: true },
      { name: 'Idade', value: String(data.idade), inline: true },
      { name: 'Recrutador', value: `<@${data.recrutadorId}>`, inline: false }
    )
    .setTimestamp();

  return applyPremiumBranding(embed);
}

function buildRejectedEmbed(data, approverTag) {
  const embed = new EmbedBuilder()
    .setTitle('❌ Recrutamento reprovado')
    .setColor(0xe74c3c)
    .setDescription(`Seu recrutamento foi reprovado por **${approverTag}**.`)
    .addFields(
      { name: 'Nome', value: data.nome, inline: true },
      { name: 'ID no jogo', value: data.idJogo, inline: true },
      { name: 'Idade', value: String(data.idade), inline: true },
      { name: 'Recrutador', value: `<@${data.recrutadorId}>`, inline: false }
    )
    .setTimestamp();

  return applyPremiumBranding(embed);
}

function buildRecruiterSelect(recruiters, userId) {
  const unique = [];
  const used = new Set();

  for (const member of recruiters) {
    if (used.has(member.id)) continue;
    used.add(member.id);
    unique.push(member);
  }

  const options = unique.slice(0, 25).map((member) => ({
    label: member.displayName.slice(0, 100),
    value: member.id,
    description: `Selecionar ${member.user.username}`.slice(0, 100),
  }));

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`select_recrutador|${userId}`)
        .setPlaceholder('Selecione quem recrutou você')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options)
    ),
  ];
}

function buildMonthlyRankingEmbed(guild, monthKey) {
  const monthRecruitments = db.recrutamentos.filter((item) => item.monthKey === monthKey);
  const counts = new Map();

  for (const item of monthRecruitments) {
    const current = counts.get(item.recrutadorId) || {
      recrutadorId: item.recrutadorId,
      total: 0,
    };
    current.total += 1;
    counts.set(item.recrutadorId, current);
  }

  const ranking = [...counts.values()].sort((a, b) => b.total - a.total);
  const top3 = ranking.slice(0, 3);

  const topLines = top3.length
    ? top3.map((item, index) => {
        const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
        return `${medal} <@${item.recrutadorId}> — **${item.total}** recrutamento(s)`;
      }).join('\n')
    : 'Nenhum recrutamento aprovado neste mês.';

  const rankingLines = ranking.length
    ? ranking.map((item, index) =>
        `**${index + 1}.** <@${item.recrutadorId}> — **${item.total}** recrutamento(s)`
      ).join('\n')
    : 'Nenhum dado disponível neste mês.';

  const embed = new EmbedBuilder()
    .setTitle(`🏆 Ranking da Liderança • ${getMonthLabel(monthKey)}`)
    .setDescription('Ranking mensal automático de recrutamentos aprovados.')
    .setColor(0xf39c12)
    .addFields(
      { name: 'Top 3 do mês', value: topLines, inline: false },
      { name: 'Ranking completo do mês', value: rankingLines.slice(0, 1024), inline: false }
    )
    .setFooter({ text: `${guild.name} • Atualização automática mensal` })
    .setTimestamp();

  return applyPremiumBranding(embed);
}

async function archivePreviousMonthIfNeeded(guild) {
  if (!CONFIG.channels.ranking) return;

  const currentMonth = getCurrentMonthKey();
  const lastChecked = db.lastArchiveCheckMonth || currentMonth;

  if (lastChecked === currentMonth) return;

  const previousMonth = lastChecked;
  const rankingChannel = await guild.channels.fetch(CONFIG.channels.ranking).catch(() => null);
  if (!rankingChannel) return;

  const archiveEmbed = buildMonthlyRankingEmbed(guild, previousMonth);

  const sent = await rankingChannel.send({
    content: `📦 Arquivo mensal fechado: **${getMonthLabel(previousMonth)}**`,
    embeds: [archiveEmbed],
  });

  db.monthlyArchiveMessageIds[previousMonth] = sent.id;
  db.lastArchiveCheckMonth = currentMonth;
  saveDb(db);
}

async function updateRankingMessage(guild) {
  if (!CONFIG.channels.ranking) return;

  await archivePreviousMonthIfNeeded(guild);

  const rankingChannel = await guild.channels.fetch(CONFIG.channels.ranking).catch(() => null);
  if (!rankingChannel) return;

  const currentMonth = getCurrentMonthKey();
  const embed = buildMonthlyRankingEmbed(guild, currentMonth);

  try {
    if (db.rankingMessageId) {
      const message = await rankingChannel.messages.fetch(db.rankingMessageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [embed] });
        return;
      }
    }

    const sent = await rankingChannel.send({ embeds: [embed] });
    db.rankingMessageId = sent.id;
    saveDb(db);
  } catch (error) {
    console.error('Erro ao atualizar ranking:', error);
  }
}

async function ensureSetagemPanel(guild) {
  const setagemChannel = await guild.channels.fetch(CONFIG.channels.setagem).catch(() => null);
  if (!setagemChannel) return;

  const embed = buildMainPanelEmbed();
  const components = buildMainPanelComponents();

  try {
    if (db.panelMessageId) {
      const existing = await setagemChannel.messages.fetch(db.panelMessageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed], components });
        return;
      }
    }

    const sent = await setagemChannel.send({ embeds: [embed], components });
    db.panelMessageId = sent.id;
    saveDb(db);
  } catch (error) {
    console.error('Erro ao garantir painel ativo:', error);
  }
}

async function collectMemberSetagemHistory(channel, memberId) {
  try {
    const collected = [];
    let lastId;

    for (let round = 0; round < 20; round++) {
      const fetched = await channel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {}),
      });

      if (!fetched.size) break;

      for (const msg of fetched.values()) {
        const content = msg.content || '';
        const mentionsMember = msg.mentions?.users?.has(memberId);
        const authorIsMember = msg.author.id === memberId;

        if (authorIsMember || mentionsMember) {
          collected.push({
            id: msg.id,
            authorId: msg.author.id,
            authorTag: msg.author.tag,
            content,
            createdAt: new Date(msg.createdTimestamp).toISOString(),
            attachments: [...msg.attachments.values()].map((a) => a.url),
          });
        }
      }

      lastId = fetched.last()?.id;
      if (fetched.size < 100) break;
    }

    return collected.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } catch (error) {
    console.error('Erro ao coletar histórico da setagem:', error);
    return [];
  }
}

async function clearMemberSetagemMessages(channel, memberId) {
  try {
    let deleted = 0;
    let lastId;

    for (let round = 0; round < 20; round++) {
      const fetched = await channel.messages.fetch({
        limit: 100,
        ...(lastId ? { before: lastId } : {}),
      });

      if (!fetched.size) break;

      const now = Date.now();
      const recentMessages = [];
      const oldMessages = [];

      for (const msg of fetched.values()) {
        const authorIsMember = msg.author.id === memberId;
        const mentionsMember = msg.mentions?.users?.has(memberId);

        if (!authorIsMember && !mentionsMember) continue;

        const ageMs = now - msg.createdTimestamp;
        const lessThan14Days = ageMs < 14 * 24 * 60 * 60 * 1000;

        if (lessThan14Days) recentMessages.push(msg);
        else oldMessages.push(msg);
      }

      if (recentMessages.length) {
        await channel.bulkDelete(recentMessages, true).catch(() => null);
        deleted += recentMessages.length;
      }

      for (const msg of oldMessages) {
        const ok = await msg.delete().then(() => true).catch(() => false);
        if (ok) deleted += 1;
      }

      lastId = fetched.last()?.id;
      if (fetched.size < 100) break;
    }

    return deleted;
  } catch (error) {
    console.error('Erro ao limpar mensagens da setagem:', error);
    return 0;
  }
}

async function hideSetagemFromMember(channel, memberId) {
  try {
    await channel.permissionOverwrites.edit(memberId, {
      ViewChannel: false,
      SendMessages: false,
      ReadMessageHistory: false,
    });
  } catch (error) {
    console.error('Erro ao ocultar setagem do membro:', error);
  }
}

async function trySetMemberNickname(member, nome, idJogo) {
  try {
    const nickname = buildMemberNickname(nome, idJogo);
    await member.setNickname(nickname);
    return { ok: true, nickname };
  } catch (error) {
    return { ok: false, error };
  }
}

async function fixMemberNicknamesFromDatabase(guild) {
  const resources = await validateResources(guild);
  if (!resources.ok) {
    return {
      success: 0,
      failed: 0,
      skipped: 0,
      details: [`Faltam recursos: ${resources.missing.join(', ')}`],
    };
  }

  await guild.members.fetch();

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const details = [];

  for (const rec of db.recrutamentos) {
    const member = guild.members.cache.get(rec.userId);
    if (!member) {
      skipped += 1;
      continue;
    }

    const hasMemberRole = member.roles.cache.has(CONFIG.roles.membro);
    if (!hasMemberRole || isManager(member)) {
      skipped += 1;
      continue;
    }

    let nome = rec.nome;
    let idJogo = rec.idJogo;

    if ((!nome || !idJogo) && Array.isArray(rec.setagemHistory)) {
      const extracted = extractNameAndGameIdFromHistory(rec.setagemHistory);
      nome = nome || extracted.nome;
      idJogo = idJogo || extracted.idJogo;

      if (nome) rec.nome = nome;
      if (idJogo) rec.idJogo = idJogo;
    }

    if (!nome || !idJogo) {
      skipped += 1;
      details.push(`${member.user.tag}: sem dados suficientes para renomear`);
      continue;
    }

    const result = await trySetMemberNickname(member, nome, idJogo);

    if (result.ok) success += 1;
    else {
      failed += 1;
      details.push(`${member.user.tag}: ${result.error?.message || 'falha ao alterar nome'}`);
    }
  }

  saveDb(db);
  return { success, failed, skipped, details };
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('painelsetagem')
      .setDescription('Recria o painel de setagem')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('rankinglideranca')
      .setDescription('Atualiza o ranking da liderança')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('corrigirnomesmembros')
      .setDescription('Corrige nomes dos membros aprovados salvos no banco')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(CONFIG.token);

  await rest.put(
    Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId),
    { body: commands }
  );

  log('✅ Comandos registrados.');
}

client.once(Events.ClientReady, async () => {
  try {
    await registerCommands();
    log(`🤖 Bot online como ${client.user.tag}`);

    const guild = await client.guilds.fetch(CONFIG.guildId).then((g) => g.fetch()).catch(() => null);
    if (guild) {
      await ensureSetagemPanel(guild);
      await updateRankingMessage(guild).catch(() => null);
    }
  } catch (error) {
    console.error('Erro ao iniciar:', error);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await member.guild.roles.fetch();

    const emSetagemRole =
      member.guild.roles.cache.get(CONFIG.roles.emSetagem) || null;

    console.log('=== GUILDMEMBERADD ===');
    console.log('Novo membro:', member.user.tag);
    console.log('Servidor:', member.guild.name);
    console.log('EM_SETAGEM_ROLE_ID:', CONFIG.roles.emSetagem);
    console.log('Cargo encontrado?', !!emSetagemRole);
    console.log('Nome do cargo:', emSetagemRole?.name);
    console.log('ID do cargo:', emSetagemRole?.id);

    if (!emSetagemRole) {
      console.log('❌ Cargo Em Setagem não encontrado.');
      return;
    }

    await member.roles.add(emSetagemRole);
    console.log(`✅ Cargo Em Setagem dado para ${member.user.tag}`);
  } catch (error) {
    console.error('❌ Erro em GuildMemberAdd:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'painelsetagem') {
        await ensureSetagemPanel(interaction.guild);
        await interaction.reply({
          content: '✅ Painel garantido no canal de setagem.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.commandName === 'rankinglideranca') {
        await updateRankingMessage(interaction.guild);
        await interaction.reply({
          content: '✅ Ranking atualizado.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.commandName === 'corrigirnomesmembros') {
        const result = await fixMemberNicknamesFromDatabase(interaction.guild);

        const lines = [
          `✅ Alterados: **${result.success}**`,
          `⚠️ Ignorados: **${result.skipped}**`,
          `❌ Falhas: **${result.failed}**`,
        ];

        if (result.details.length) {
          lines.push('', '**Detalhes das falhas:**');
          lines.push(result.details.slice(0, 10).map((d) => `• ${d}`).join('\n'));
        }

        await interaction.reply({
          content: lines.join('\n'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === CONFIG.panelCustomId) {
        if (db.pendentes[interaction.user.id]) {
          await interaction.reply({
            content: '⏳ Você já possui uma setagem pendente.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId('modal_setagem')
          .setTitle('Setagem • FURIA');

        const nomeInput = new TextInputBuilder()
          .setCustomId('nome')
          .setLabel('Seu nome')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40);

        const idJogoInput = new TextInputBuilder()
          .setCustomId('id_jogo')
          .setLabel('Seu ID no jogo')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30);

        const idadeInput = new TextInputBuilder()
          .setCustomId('idade')
          .setLabel('Sua idade')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nomeInput),
          new ActionRowBuilder().addComponents(idJogoInput),
          new ActionRowBuilder().addComponents(idadeInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (
        interaction.customId.startsWith('aprovar_rec|') ||
        interaction.customId.startsWith('reprovar_rec|')
      ) {
        if (!hasApprovalRole(interaction.member)) {
          await interaction.reply({
            content: '❌ Você não tem permissão para isso.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const [action, userId] = interaction.customId.split('|');
        const pending = db.pendentes[userId];

        if (!pending) {
          await interaction.reply({
            content: '❌ Este recrutamento não está mais pendente.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferUpdate();

        try {
          const resources = await validateResources(interaction.guild);

          if (!resources.ok) {
            await interaction.editReply({
              content: `❌ Faltam recursos:\n${resources.missing.map((x) => `• ${x}`).join('\n')}`,
              embeds: [],
              components: [],
            });
            return;
          }

          const member = await interaction.guild.members.fetch(userId).catch(() => null);

          if (!member) {
            delete db.pendentes[userId];
            saveDb(db);

            await interaction.editReply({
              content: '❌ Membro não encontrado.',
              embeds: interaction.message.embeds,
              components: [],
            });
            return;
          }

          if (action === 'reprovar_rec') {
            delete db.pendentes[userId];
            saveDb(db);

            await interaction.editReply({
              content: `❌ Recrutamento reprovado por ${interaction.user}.`,
              embeds: interaction.message.embeds,
              components: [],
            });

            await member.send({
              embeds: [buildRejectedEmbed(pending, interaction.user.tag)],
            }).catch(() => null);

            return;
          }

          const setagemHistory = await collectMemberSetagemHistory(resources.setagemChannel, member.id);
          const extractedFromHistory = extractNameAndGameIdFromHistory(setagemHistory);

          const finalNome = pending.nome || extractedFromHistory.nome || 'Sem nome';
          const finalIdJogo = pending.idJogo || extractedFromHistory.idJogo || '000000';

          let removedSetagem = true;
          let addedMembro = true;
          let nicknameResult = { ok: false };

          await member.roles.remove(resources.emSetagemRole).catch((err) => {
            removedSetagem = false;
            console.error('Erro ao remover Em Setagem:', err);
          });

          await member.roles.add(resources.membroRole).catch((err) => {
            addedMembro = false;
            console.error('Erro ao adicionar Membro:', err);
          });

          nicknameResult = await trySetMemberNickname(member, finalNome, finalIdJogo);

          await hideSetagemFromMember(resources.setagemChannel, member.id).catch((err) => {
            console.error('Erro ao ocultar setagem:', err);
          });

          const deletedMessages = await clearMemberSetagemMessages(
            resources.setagemChannel,
            member.id
          );

          const monthKey = getCurrentMonthKey();

          db.recrutamentos.push({
            userId: member.id,
            userTag: member.user.tag,
            nome: finalNome,
            idJogo: finalIdJogo,
            idade: pending.idade,
            recrutadorId: pending.recrutadorId,
            recrutadorTag: pending.recrutadorTag,
            aprovadoPor: interaction.user.tag,
            aprovadoPorId: interaction.user.id,
            aprovadoEm: new Date().toISOString(),
            monthKey,
            setagemHistory,
            nicknameApplied: nicknameResult.ok,
          });

          delete db.pendentes[userId];
          saveDb(db);

          await interaction.editReply({
            content: `✅ Recrutamento aprovado por ${interaction.user}.`,
            embeds: interaction.message.embeds,
            components: [],
          });

          await member.send({
            embeds: [buildApprovedEmbed(
              {
                ...pending,
                nome: finalNome,
                idJogo: finalIdJogo,
              },
              interaction.user.tag
            )],
          }).catch(() => null);

          if (setagemHistory.length) {
            const preview = setagemHistory
              .slice(0, 15)
              .map((msg, index) => {
                const text = msg.content ? msg.content.slice(0, 120) : '[sem texto]';
                return `**${index + 1}.** <@${msg.authorId}>: ${text}`;
              })
              .join('\n');

            const historyEmbed = applyPremiumBranding(
              new EmbedBuilder()
                .setTitle('🗂️ Histórico da setagem registrado')
                .setColor(0x3498db)
                .setDescription(preview || 'Nenhuma mensagem encontrada.')
                .addFields(
                  { name: 'Membro', value: `<@${member.id}>`, inline: true },
                  { name: 'Mensagens salvas', value: String(setagemHistory.length), inline: true }
                )
                .setFooter({ text: `User ID: ${member.id}` })
                .setTimestamp()
            );

            await resources.logsChannel.send({
              content: `📚 Histórico salvo de <@${member.id}> antes da limpeza.`,
              embeds: [historyEmbed],
            }).catch((err) => {
              console.error('Erro ao enviar histórico para logs:', err);
            });
          }

          await updateRankingMessage(interaction.guild).catch((err) => {
            console.error('Erro ao atualizar ranking:', err);
          });

          const followUpLines = [
            `🧹 Histórico limpo com sucesso. Mensagens apagadas: ${deletedMessages}`,
          ];

          if (!removedSetagem) {
            followUpLines.push('⚠️ Não consegui remover o cargo de setagem.');
          }

          if (!addedMembro) {
            followUpLines.push('⚠️ Não consegui adicionar o cargo de membro.');
          }

          if (nicknameResult.ok) {
            followUpLines.push(`🏷️ Nome alterado para: **${nicknameResult.nickname}**`);
          } else {
            followUpLines.push('⚠️ Não consegui alterar o nome do membro. Verifique a hierarquia do bot.');
          }

          await interaction.followUp({
            content: followUpLines.join('\n'),
            flags: MessageFlags.Ephemeral,
          });

          return;
        } catch (error) {
          console.error('❌ Erro no fluxo de aprovação/reprovação:', error);

          await interaction.editReply({
            content: `❌ Recrutamento falhou, mas parte da ação pode ter sido executada.\nErro: ${error.message}`,
            embeds: interaction.message.embeds,
            components: [],
          }).catch(() => null);

          return;
        }
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId !== 'modal_setagem') return;

      const nome = normalizeText(interaction.fields.getTextInputValue('nome'), 40);
      const idJogo = normalizeText(interaction.fields.getTextInputValue('id_jogo'), 30);
      const idadeText = normalizeText(interaction.fields.getTextInputValue('idade'), 2);

      if (!/^\d{1,2}$/.test(idadeText)) {
        await interaction.reply({
          content: '❌ A idade precisa conter apenas números.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const idade = Number(idadeText);

      if (idade < CONFIG.minAge || idade > CONFIG.maxAge) {
        await interaction.reply({
          content: `❌ A idade deve estar entre ${CONFIG.minAge} e ${CONFIG.maxAge}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const recruiters = await getRecruiterMembers(interaction.guild);

      if (!recruiters.length) {
        await interaction.reply({
          content: '❌ Não encontrei líderes/recs/gerência disponíveis para seleção.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      db.pendentes[interaction.user.id] = {
        userId: interaction.user.id,
        nome,
        idJogo,
        idade,
        createdAt: new Date().toISOString(),
      };
      saveDb(db);

      await interaction.reply({
        embeds: [buildRecruiterPanelEmbed()],
        components: buildRecruiterSelect(recruiters, interaction.user.id),
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith('select_recrutador|')) return;

      const [, userId] = interaction.customId.split('|');

      if (interaction.user.id !== userId) {
        await interaction.reply({
          content: '❌ Você não pode usar a seleção de outro usuário.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const pending = db.pendentes[userId];
      if (!pending) {
        await interaction.reply({
          content: '❌ Sua setagem não foi encontrada.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const recrutadorId = interaction.values[0];
      const recruiterMember = await interaction.guild.members.fetch(recrutadorId).catch(() => null);

      if (!recruiterMember) {
        await interaction.reply({
          content: '❌ Não consegui encontrar o recrutador selecionado.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      pending.recrutadorId = recruiterMember.id;
      pending.recrutadorTag = recruiterMember.user.tag;

      db.pendentes[userId] = pending;
      saveDb(db);

      const resources = await validateResources(interaction.guild);
      if (!resources.ok) {
        await interaction.reply({
          content: `❌ Faltam recursos:\n${resources.missing.map((x) => `• ${x}`).join('\n')}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await resources.logsChannel.send({
        embeds: [buildLogEmbed(pending)],
        components: buildApprovalButtons(userId),
      });

      await interaction.update({
        content: '✅ Sua setagem foi enviada para análise da liderança.',
        embeds: [],
        components: [],
      });

      return;
    }
  } catch (error) {
    console.error('❌ Erro detalhado na interação:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Ocorreu um erro ao processar sua solicitação.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }
});

client.login(CONFIG.token);
