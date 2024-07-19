import type {LocalizationMap} from "discord-api-types/v10";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Переводчик на другие языки
 * @const locales
 */
const locales = {
    "on": {
        ru: "вкл",
        "en-US": "on"
    },
    "off": {
        ru: "выкл",
        "en-US": "off"
    },
    "yes": {
        ru: "да",
        "en-US": "yes"
    },
    "cancel": {
        ru: "отмена",
        "en-US": "cancel"
    },
    "undefined": {
        ru: "нет",
        "en-US": "nope"
    },
    "ping": {
        ru: "Задержка - {ARGUMENT} | WS - {ARGUMENT} | Время работы: {ARGUMENT}",
        "en-US": "Latency - {ARGUMENT} | WS - {ARGUMENT} | Uptime: {ARGUMENT}"
    },
    "queue": {
        ru: "Queue - {ARGUMENT}",
        "en-US": "Queue - {ARGUMENT}"
    },
    "error.retry": {
        ru: "{ARGUMENT} | Ошибка... попробуй еще раз!!!",
        "en-US": "{ARGUMENT} | Mistake... try again!!!"
    },
    "platform.block.retry": {
        ru: "{ARGUMENT} | Платформа уже заблокирована!",
        "en-US": "{ARGUMENT} | The platform is already blocked!"
    },
    "platform.block": {
        ru: "{ARGUMENT} | Платформа заблокирована!",
        "en-US": "{ARGUMENT} | Platform is blocked!"
    },
    "platform.unlock.retry": {
        ru: "{ARGUMENT} | Платформа не заблокирована!",
        "en-US": "{ARGUMENT} | The platform is not blocked!"
    },
    "platform.unlock": {
        ru: "{ARGUMENT} | Платформа разблокирована!",
        "en-US": "{ARGUMENT} | The platform is unlocked!"
    },
    "player.history": {
        ru: "История прослушиваний",
        "en-US": "Audition History"
    },
    "player.history.null": {
        ru: "{ARGUMENT} | На этом сервере еще не включали музыку!",
        "en-US": "{ARGUMENT} | Music has not been turned on on this server yet!"
    },
    "player.history.disable": {
        ru: "{ARGUMENT} | История прослушиваний выключена!",
        "en-US": "{ARGUMENT} | Listening history is off!"
    },
    "player.played.not": {
        ru: "{ARGUMENT} | Музыка еще не играет!",
        "en-US": "{ARGUMENT} | The music is not playing yet!"
    },
    "player.paused": {
        ru: "{ARGUMENT} | Музыка уже приостановлена!",
        "en-US": "{ARGUMENT} | The music has already been suspended!"
    },
    "player.played": {
        ru: "{ARGUMENT} | Музыка уже приостановлена!",
        "en-US": "{ARGUMENT} | The music has already been suspended!"
    },
    "player.wait": {
        ru: "{ARGUMENT} | на данном этапе, паузу не возможно поставить!",
        "en-US": "{ARGUMENT} | at this stage, it is not possible to pause!"
    },
    "player.audio.live": {
        ru: "{ARGUMENT} | А как? Это же стрим!",
        "en-US": "{ARGUMENT} | And how? It's a stream!"
    },
    "player.radio.enable": {
        ru: "{ARGUMENT} | Включен режим радио!",
        "en-US": "{ARGUMENT} | Radio mode is on!"
    },
    "player.radio.enable.retry": {
        ru: "{ARGUMENT} | Уже включен режим радио!",
        "en-US": "{ARGUMENT} | Radio mode is already enabled!"
    },
    "player.radio.disable": {
        ru: "{ARGUMENT} | Выключен режим радио!",
        "en-US": "{ARGUMENT} | Radio mode is off!!"
    },
    "player.radio.disable.retry": {
        ru: "{ARGUMENT} | Уже выключен режим радио!",
        "en-US": "{ARGUMENT} | Radio mode is already turned off!"
    },
    "player.radio.enable.rule": {
        ru: "{ARGUMENT} | Эта команда доступна только для права \`{ARGUMENT}\`!",
        "en-US": "{ARGUMENT} | This command is only available for the right \`{ARGUMENT}\`!"
    },
    "player.radio.rule": {
        ru: "{ARGUMENT} | В данные момент включен режим радио для отключения необходимо иметь право \`{ARGUMENT}\`!",
        "en-US": "{ARGUMENT} | At this moment, the radio mode is turned on. To turn it off, you must have the right \`{ARGUMENT}\`!"
    },
    "player.queue.null": {
        ru: "{ARGUMENT} | Музыка сейчас не играет.",
        "en-US": "{ARGUMENT} | The music is not playing right now."
    },
    "player.queue.destroy": {
        ru: "{ARGUMENT} | Музыкальная очередь удалена!",
        "en-US": "{ARGUMENT} | The music queue has been deleted!"
    },
    "player.voice.inactive": {
        ru: "{ARGUMENT} | Необходимо подключиться к голосовому каналу!",
        "en-US": "{ARGUMENT} | You need to connect to the voice channel!"
    },
    "player.voice.bot.inactive": {
        ru: "{ARGUMENT} | Я не подключен к голосовому каналу!",
        "en-US": "{ARGUMENT} | I am not connected to the voice channel!"
    },
    "player.voice.active": {
        ru: "{ARGUMENT} | Музыка уже играет в другом голосовом канале!\nМузыка включена тут <#{ARGUMENT}>",
        "en-US": "{ARGUMENT} | The music is already playing in another voice channel!\nMusic is included here <#{ARGUMENT}>",
    },
    "player.voice.leave": {
        ru: "{ARGUMENT} | Отключение от голосового канала!",
        "en-US": "{{ARGUMENT} | Disconnecting from the voice channel!"
    },
    "player.voice.stage": {
        ru: "{ARGUMENT} | Этот голосовой канал не является трибуной!",
        "en-US": "{ARGUMENT} | This voice channel is not a tribune!"
    },
    "player.voice.leave.forQueue": {
        ru: "{ARGUMENT} | Отключение от голосового канала! Очередь будет удалена!",
        "en-US": "{ARGUMENT} | Disconnecting from the voice channel! The queue will be deleted!"
    },
    "InteractionCreate.guild": {
        ru: "{ARGUMENT}, эта команда предназначена для сервера!",
        "en-US": "{ARGUMENT}, this command is for the server!"
    },
    "InteractionCreate.owner": {
        ru: "{ARGUMENT}, эта команда предназначена для разработчиков!",
        "en-US": "{ARGUMENT}, this command is for developers!"
    },
    "InteractionCreate.command.null": {
        ru: "{ARGUMENT}, у меня нет этой команды!",
        "en-US": "{ARGUMENT}, I don't have this command!"
    },
    "InteractionCreate.button.wtf": {
        ru: "{ARGUMENT} | Откуда ты взял эту кнопку!",
        "en-US": "{ARGUMENT} | Where did you get this button from!"
    },
    "InteractionCreate.button.arg": {
        ru: "{ARGUMENT}, но играет всего один трек!",
        "en-US": "{ARGUMENT}, but only one track is playing!"
    },
    "InteractionCreate.button.last": {
        ru: "{ARGUMENT}, прошлый трек был возвращен!",
        "en-US": "{ARGUMENT}, the last track was returned!"
    },
    "InteractionCreate.button.shuffle": {
        ru: "{ARGUMENT}, перетасовка треков {ARGUMENT}!",
        "en-US": "{ARGUMENT}, shuffling tracks {ARGUMENT}!"
    },
    "player.message.playing.last": {
        ru: "**Последний трек:**",
        "en-US": "**Last track:**"
    },
    "player.message.playing.current": {
        ru: "**Играет:**",
        "en-US": "**Is playing:**"
    },
    "player.message.playing.next": {
        ru: "**Следующее: **",
        "en-US": "**Next: **"
    },
    "player.message.playing.next.alt": {
        ru: "**Следующее - {ARGUMENT}**",
        "en-US": "**Next - {ARGUMENT}**"
    },
    "player.message.push.track": {
        ru: "**Добавлен трек:**",
        "en-US": "**Added track:**"
    },
    "player.message.push.list": {
        ru: "**Добавлен плейлист:**",
        "en-US": "**Playlist added:**"
    },
    "player.message.search.fail": {
        ru: "{ARGUMENT} | Я не смог найти музыку с таким названием. Попробуй другое название!",
        "en-US": "{ARGUMENT} | I couldn't find any music with that name. Try another name!"
    },
    "player.message.search.ok": {
        ru: "Вот что мне удалось найти!",
        "en-US": "Here's what I managed to find!"
    },
    "api.type.null": {
        ru: "**{ARGUMENT}**\n\nУ меня нет поддержки этого запроса!",
        "en-US": "**{ARGUMENT}**\n\n I do not have support for this request!"
    },
    "api.callback.null": {
        ru: "**{ARGUMENT}.{ARGUMENT}**\n\nУ меня нет поддержки для выполнения этого запроса!",
        "en-US": "**{ARGUMENT}.{ARGUMENT}**\n\nI do not have support for this request!"
    },
    "api.auth": {
        ru: "**{ARGUMENT}**\n\nНет данных для авторизации, запрос не может быть выполнен!",
        "en-US": "**{ARGUMENT}**\n\n There is no authorization data, the request cannot be executed!"
    },
    "api.type.fail": {
        ru: "**{ARGUMENT}**\n\nЭтот запрос не относится к этой платформе!",
        "en-US": "**{ARGUMENT}**\n\nThis request does not apply to this platform!"
    },
    "api.wait": {
        ru: `**{ARGUMENT}.{ARGUMENT}**\n\n${env.get("loading.emoji")} Ожидание ответа от сервера...\n{ARGUMENT}`,
        "en-US": `**{ARGUMENT}.{ARGUMENT}**\n\n${env.get("loading.emoji")} Waiting for a response from the server...\n{ARGUMENT}`
    },
    "api.wait.fail": {
        ru: `**{ARGUMENT}.{ARGUMENT}**\n\nПревышено время ожидания ответа, возможно сервис сейчас недоступен!`,
        "en-US": `**{ARGUMENT}.{ARGUMENT}**\n\nThe response waiting time has been exceeded, the service may not be available now!`
    },
    "api.audio.null": {
        ru: "Эта платформа не может выдать исходный файл музыки! Поиск трека!",
        "en-US": "This platform cannot output the original music file! Track search!"
    },
    "api.fail": {
        ru: "**{ARGUMENT}.{ARGUMENT}**\n\n**❯** Данные не были получены!",
        "en-US": "**{ARGUMENT}.{ARGUMENT}**\n\n**Data was not received!"
    },
    "api.blocked": {
        ru: "**{ARGUMENT}**\n\nРазработчик заблокировал доступ к этой платформе!\nВозможно из-за ошибки или блокировки со стороны сервера!",
        "en-US": "**{ARGUMENT}**\n\The developer blocked access to this platform!\It is possible due to an error or blocking by the server!"
    },
    "global.arg.NaN": {
        ru: "{ARGUMENT} | Аргумент не является числом",
        "en-US": "{ARGUMENT} | The argument is not a number"
    },
    "global.listOf": {
        ru: "{ARGUMENT} | Лист {ARGUMENT} из {ARGUMENT}",
        "en-US": "{ARGUMENT} | Sheet {ARGUMENT} of {ARGUMENT}"
    },
    "global.listOf.queue": {
        ru: "{ARGUMENT} | Лист {ARGUMENT} из {ARGUMENT} | Songs: {ARGUMENT}/{ARGUMENT}",
        "en-US": "{ARGUMENT} | Sheet {ARGUMENT} of {ARGUMENT} | Songs: {ARGUMENT}/{ARGUMENT}"
    },
    "command.help.title": {
        ru: "Информация о команде!",
        "en-US": "Information about the command!"
    },
    "command.help": {
        ru: "┌ Команда [**{ARGUMENT}**]\n├ **Используется:** {ARGUMENT} {ARGUMENT}\n├ **Для разработчика:** ({ARGUMENT})\n└ **Описание:** ({ARGUMENT})",
        "en-US": "┌ Command [**{ARGUMENT}**]\n├ **Is used:** {ARGUMENT} {ARGUMENT}\n├ **For the developer:** ({ARGUMENT})\n└ **Description:** ({ARGUMENT})"
    },
    "command.help.null": {
        ru: "Я не могу найти такую команду!",
        "en-US": "I not found a this command!"
    },
    "command.info.author": {
        ru: "Разработчик: @snippik",
        "en-US": "Developer: @snippik"
    },
    "command.info.title": {
        ru: "Информация",
        "en-US": "Information"
    },
    "command.info.page": {
        ru: "• Версия:    => {ARGUMENT}\n" +
            "• Процессор: => {ARGUMENT}\n" +
            "• Node:      => {ARGUMENT}\n" +
            "• Дубликатов => {ARGUMENT}\n" +
            "\n" +
            "• Дубликат [{ARGUMENT}]\n" +
            "• Серверов   => {ARGUMENT}\n" +
            "• Каналов    => {ARGUMENT}\n" +
            "• Очередей   => {ARGUMENT}\n" +
            "• Команд     => {ARGUMENT}\n" +
            "\n" +
            "> Память [{ARGUMENT}]\n" +
            "   Используется   => [{ARGUMENT}]\n" +
            "   Доступно       => [{ARGUMENT}]\n",
        "en-US": "• Version:    => {ARGUMENT}\n" +
            "• Processor:  => {ARGUMENT}\n" +
            "• Node:       => {ARGUMENT}\n" +
            "• Duplicates  =>{ARGUMENT}\n" +
            "\n" +
            "• Duplicate [{ARGUMENT}]\n" +
            "• Servers  => {ARGUMENT}\n" +
            "• Channels => {ARGUMENT}\n" +
            "• Queues   => {ARGUMENT}\n" +
            "• Commands => {ARGUMENT}\n" +
            "\n" +
            "> Memory [{ARGUMENT}]\n" +
            " Used      => [{ARGUMENT}]\n" +
            " Available => [{ARGUMENT}]\n",
    },
    "command.info.os": {
        ru: "OS",
        "en-US": "OS"
    },
    "command.owner.avatar.null.image": {
        ru: "Этот файл не является изображением!",
        "en-US": "This file is not an image!"
    },
    "command.owner.avatar": {
        ru: "Установлен новый аватар",
        "en-US": "A new avatar has been installed"
    },
    "command.owner.avatar.fail": {
        ru: "Не удалось установить новый аватар\nError: {ARGUMENT}",
        "en-US": "Failed to install a new avatar\nError: {ARGUMENT}"
    },
    "command.voice.re-configure": {
        ru: "{ARGUMENT} | Перенастройка подключения!",
        "en-US": "{ARGUMENT} | Reconfiguring the connection!"
    },
    "command.voice.stage.request": {
        ru: "{ARGUMENT} | Запрос на трибуну отправлен!",
        "en-US": "{ARGUMENT} | The request to the podium has been sent!"
    },
    "command.voice.stage.request.error": {
        ru: "{ARGUMENT} | Не удалось отправить запрос!",
        "en-US": "{ARGUMENT} | The request could not be sent!"
    },
    "command.voice.stage.join": {
        ru: "{ARGUMENT} | Подключение к трибуне произведено!",
        "en-US": "{ARGUMENT} | Connection to the podium has been made!"
    },
    "command.voice.stage.join.error": {
        ru: "{ARGUMENT} | Не удалось подключиться к трибуне!",
        "en-US": "{ARGUMENT} | Couldn't connect to the podium!"
    },
    "command.ffmpeg.seek.args.null": {
        ru: "{ARGUMENT} | Укажи время, пример 00:00:00!",
        "en-US": "{ARGUMENT} | Specify the time, for example 00:00:00!"
    },
    "command.ffmpeg.seek.args.big": {
        ru: "{ARGUMENT} | Ты указал слишком много времени!",
        "en-US": "{ARGUMENT} | You've given too much time!"
    },
    "command.ffmpeg.seek.end": {
        ru: "⏭️ | Seeking to [{ARGUMENT}] song\n> {ARGUMENT}",
        "en-US": "⏭️ | Seeking to [{ARGUMENT}] song\n> {ARGUMENT}"
    },
    "command.control.replay": {
        ru: "🔂 | Replay | {ARGUMENT}",
        "en-US": "🔂 | Replay | {ARGUMENT}"
    },
    "command.control.pause": {
        ru: "⏸ | Pause song | {ARGUMENT}",
        "en-US": "⏸ | Pause song | {ARGUMENT}"
    },
    "command.control.resume": {
        ru: "▶️ | Resume song | {ARGUMENT}",
        "en-US": "▶️ | Resume song | {ARGUMENT}"
    },
    "command.play.attachment.audio.need": {
        ru: "{ARGUMENT} | В файле должна быть только звуковая дорожка!",
        "en-US": "{ARGUMENT} | The file should contain only the audio track!"
    },
    "command.contact.info": {
        ru: "Раздел для связи с разработчиком!",
        "en-US": "A section for contacting the developer!"
    },
    "command.control.repeat.off": {
        ru: "❌ | Повтор выключен",
        "en-US": "❌ | Repeat is off"
    },
    "command.control.repeat.one": {
        ru: "🔂 | Повтор  | {ARGUMENT}",
        "en-US": "🔂 | Repeat | {ARGUMENT}"
    },
    "command.control.repeat.all": {
        ru: "🔁 | Повтор всей музыки",
        "en-US": "🔁 | Repeat all the music"
    },
    "command.control.skip.arg": {
        ru: "{ARGUMENT} | В очереди {ARGUMENT}!",
        "en-US": "{ARGUMENT} | In the {ARGUMENT} queue!"
    },
    "command.control.skip.songs": {
        ru: "⏭️ | Skip to song [{ARGUMENT}] | {ARGUMENT}",
        "en-US": "⏭️ | Skip to song [{ARGUMENT}] | {ARGUMENT}"
    },
    "command.control.skip.song": {
        ru: "⏭️ | Skip song | {ARGUMENT}",
        "en-US": "⏭️ | Skip song | {ARGUMENT}"
    },
    "command.control.remove.arg": {
        ru: "{ARGUMENT} | Я не могу убрать музыку, поскольку всего {ARGUMENT}!",
        "en-US": "{ARGUMENT} | I can't remove the music because it's just {ARGUMENT}!"
    },
    "command.control.remove.song": {
        ru: "⏭️ | Remove song | {ARGUMENT}",
        "en-US": "⏭️ | Remove song | {ARGUMENT}"
    },
    "command.filter.live": {
        ru: "{ARGUMENT} | Фильтры не могут работать совместно с Live треками!",
        "en-US": "{ARGUMENT} | Filters cannot work in conjunction with Live tracks!"
    },
    "command.filter.total.current.null": {
        ru: "{ARGUMENT}, включенных аудио фильтров нет!",
        "en-US": "{ARGUMENT}, there are no audio filters enabled!"
    },
    "command.filter.all": {
        ru: "Все фильтры",
        "en-US": "All filters"
    },
    "command.filter.list": {
        ru: "┌Номер в списке - [{ARGUMENT}]\n├ **Название:** {ARGUMENT}\n├ **Аргументы:** {ARGUMENT}\n├ **Модификатор скорости:** {ARGUMENT}\n└ **Описание:** {ARGUMENT}",
        "en-US": "┌Number in the list - [{ARGUMENT}]\n├**Name:** {ARGUMENT}\n├ **Arguments:** {ARGUMENT}\n├**Speed modifier:** {ARGUMENT}\n└ **Description:** {ARGUMENT}"
    },
    "command.filter.not.support": {
        ru: "{ARGUMENT}, найден не совместимый фильтр! {ARGUMENT} нельзя использовать вместе с {ARGUMENT}",
        "en-US": "{ARGUMENT}, an incompatible filter has been found! {ARGUMENT} cannot be used together with {ARGUMENT}"
    },
    "command.filter.not.enable": {
        ru: "Filter: {ARGUMENT} не изменен из-за несоответствия аргументов!\nMin: ${ARGUMENT} | Max: ${ARGUMENT}",
        "en-US": "Filter: {ARGUMENT} has not been changed due to an argument mismatch!\nMin: ${ARGUMENT} | Max: ${ARGUMENT}"
    },
    "command.filter.enable.retry": {
        ru: "Filter: {ARGUMENT} уже включен!",
        "en-US": "Filter: {ARGUMENT} is already enabled!"
    },
    "command.filter.enable": {
        ru: "**Filter:**\n{ARGUMENT} включен!",
        "en-US": "**Filter:**\n{ARGUMENT} enabled!"
    },
    "command.filter.disable.retry": {
        ru: "Filter: {ARGUMENT} не включен!",
        "en-US": "Filter: {ARGUMENT} is not enabled!"
    },
    "command.filter.disable": {
        ru: "**Filter:**\n{ARGUMENT} выключен!",
        "en-US": "**Filter:**\n{ARGUMENT} is disabled!"
    }
};

/**
 * @author SNIPPIK
 * @description Все доступные языки для помощи
 * @type languages
 */
type languages = keyof LocalizationMap;

/**
 * @author SNIPPIK
 * @description Все доступные имена переменных для помощи
 * @type locale_text
 */
type locale_text = keyof typeof locales;

/**
 * @author SNIPPIK
 * @description Переводчик на разные языки
 * @class locale
 */
export class locale {
    private static readonly language = env.get("language");
    /**
     * @description Перевод на другие языки, перевод берется из базы
     * @param language - Тип locale для перевода
     * @param context - Имя перевода
     * @param args - Аргументы будут подставлены автоматически вместо "{ARGUMENT}" в порядке очереди
     */
    public static _ = (language: languages, context: locale_text, args?: any[]) => {
        //@ts-ignore
        let translate = locales[context] as string;

        //Если нет такой строки
        if (!translate) return `Error: Not found locale ${context}`;

        translate = translate[language] as string;

        //Если нет такого перевода
        if (!translate) translate = translate[this.language];

        //Если есть аргументы
        if (args && args.length > 0) {
            for (let i = 0; i < args.length; i++) {
                translate = translate.replace("{ARGUMENT}", args[i]);
            }
        }

        return translate;
    };
}