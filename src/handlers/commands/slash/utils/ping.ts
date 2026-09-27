import { ApplicationIntegrationType, InteractionContextType } from "seyfert/lib/types/index.js";
import { Command, type CommandContext, Declare, Embed, Locales } from "seyfert";
import { Colors } from "#structures/discord/index.js";
import { MessageFlags } from "discord-api-types/v10";
import { locale } from "#structures";

@Declare({
    name: "ping",
    description: "Get a current client ping",
    // Доступна и как серверная, и как user-install команда.
    integrationTypes: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],

    // Контексты: гильдия, ЛС бота, приватный канал (группа с ботом).
    contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
})
@Locales({
    name: [
        ["ru", "пинг"],
        ["en-US", "ping"]
    ],
    description: [
        ["ru", "Получение текущей задержки клиента!"],
        ["en-US", "Get a current client ping"]
    ]
})
export default class PingCommand extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        const { client } = ctx;

        // Первый (промежуточный) ответ: жёлтый embed с текстом "измеряю...".
        // setTimestamp() — чтобы было видно, когда именно отправлено.
        const embed = new Embed()
            .setColor(Colors.Yellow)
            .setDescription(locale._(ctx.interaction.locale, "command.ping.wait"))
            .setTimestamp();

        // editOrReply: если interaction ещё не отвечен — reply, иначе edit.
        // Это безопасно для обоих случаев (первый вызов = reply).
        await ctx.editOrReply({ embeds: [embed], flags: MessageFlags.Ephemeral });

        // --- Сбор метрик задержки ---

        // id шарда, на котором обслуживается этот interaction.
        const shardId = ctx.shardId;

        // WS-латентность шарда: округляем до целого мс.
        const wsPing = Math.floor(client.gateway.latency);

        // "Клиентская" задержка = время от создания interaction/message
        // до момента, когда мы его обработали.
        // ctx.message — для message-based контекстов, ctx.interaction — для slash.
        // Оператор ?? выбирает то, что реально есть.
        const clientPing = Math.floor(Date.now() - (ctx.message ?? ctx.interaction)!.createdTimestamp);

        // Дополнительный ping конкретного шарда через gateway.get(shardId)?.ping().
        // Опциональная цепочка: шард мог исчезнуть / быть ещё не готов;
        // ?? 0 — если ping недоступен, показываем 0 вместо NaN/undefined.
        const shardPing = Math.floor((await ctx.client.gateway.get(shardId)?.ping()) ?? 0);

        // --- Финальный ответ ---

        // Переиспользуем тот же embed: меняем цвет на зелёный и
        // подставляем посчитанные значения через i18n.
        // Порядок аргументов: wsPing, clientPing, shardId, shardPing —
        // должен совпадать с плейсхолдерами в строке "command.ping.responce".
        embed
            .setColor(Colors.Green)
            .setDescription(locale._(ctx.interaction.locale, "command.ping.responce", [wsPing, clientPing, shardId, shardPing]));

        // Редактируем ранее отправленный embed — без повторной отправки.
        await ctx.editOrReply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}