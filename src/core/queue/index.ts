import { Colors, CommandInteraction } from "#structures/discord/index.js";
import { CycleInteraction } from "#structures/discord/index.js";
import { ControllerCycles } from "./controllers/cycle.js";
import { Track } from "#core/queue/structures/track.js";
import { APIRequestData } from "#handler/rest/index.js";
import { Queue } from "#core/queue/structures/queue.js";
import { QueueMessage } from "./modules/message.js";
import { Collection, locale } from "#structures";
import { env } from "#db/env";
import { db } from "#db";

export * from "./structures/tracks.js";
export * from "./structures/voice.js";
export * from "./structures/track.js";
export * from "./structures/queue.js";

/**
 * @author SNIPPIK
 * @description Базовый класс контроллера очередей, содержит в себе главные функции управления
 * @class BaseQueueController
 * @private
 */
class BaseQueueController<T extends Queue = Queue> extends Collection<T> {
    /** Хранилище циклов для работы музыки */
    public cycles = new ControllerCycles();

    /**
     * @description Создание очереди.
     * @public
     */
    public create = (message: CommandInteraction) => {
        const guildId = message.guildId;

        let queue = this.get(guildId);

        // Очереди ещё нет: создаём её и регистрируем в коллекции.
        if (!queue) {
            queue = new Queue(message) as T;

            this.set(guildId, queue);

            return queue;
        }

        // Не вмешиваемся в плеер, если им уже управляет цикл
        // либо аудиоресурс ещё находится в процессе предварительной загрузки.
        if (
            this.cycles.players.has(queue.player) ||
            queue.player.audio.preloaded
        ) {
            return queue;
        }

        // Отложенное восстановление позволяет сначала завершить
        // обработку текущего взаимодействия.
        setImmediate(() => {
            void this.restorePlayback(queue, message);
        });

        return queue;
    };

    /**
     * @description Выключение системы очереди.
     * @public
     */
    public shutdown = () => {
        let timeout = 0;

        for (const queue of this.array) {
            if (!queue.player.playing || !queue.player.audio?.current) {
                continue;
            }

            if (this.cycles.players.has(queue.player)) {
                const remaining = queue.player.audio.current.packets * 20;

                if (timeout < remaining) {
                    timeout = remaining;
                }
            }

            queue.message.send({
                withResponse: false,
                embeds: [
                    {
                        //@ts-ignore
                        description: locale._(queue.message.locale, `self.reboot`),
                        color: Colors.Yellow
                    }
                ]
            }).then((msg) => {
                setTimeout(() => {
                    if (msg.delete) {
                        msg.delete().catch(() => null);
                    }
                }, timeout ?? 1e3);
            });

            queue.player.removeAllListeners();

            this.remove(queue.message.guild_id, true);
        }

        return timeout;
    };

    /**
     * Восстанавливает воспроизведение существующей очереди.
     *
     * Перед запуском:
     * - выбирает начальную позицию согласно настройкам повторения;
     * - снимает паузу, если плеер приостановлен;
     * - запускает воспроизведение;
     * - при необходимости переносит сообщение очереди в новый канал.
     *
     * Метод намеренно отделён от create(), чтобы логика восстановления
     * не смешивалась с созданием и поиском очереди.
     *
     * @param queue - Очередь, воспроизведение которой нужно восстановить.
     * @param interaction - Взаимодействие, из которого получен новый канал.
     * @returns Promise, завершающийся после выполнения операции.
     * @internal
     */
    private restorePlayback = async (queue: T, interaction: CommandInteraction): Promise<void> => {
        const player = queue.player;

        // Защищаемся от ситуации, когда состояние плеера изменилось
        // за время между вызовом create() и выполнением setImmediate().
        if (this.cycles.players.has(player) || player.audio.preloaded) return;

        // При replay = 1 выбираем последний элемент очереди.
        // В остальных режимах начинаем с первого элемента.
        switch (db.queues.options.replay) {
            case 1: {
                queue.tracks.position = queue.tracks.total - 1;
                break;
            }

            default: {
                queue.tracks.position = 0;
                break;
            }
        }

        // Сначала снимаем паузу, если она установлена.
        if (player.status === "player/pause") player.resume();

        // Ошибку воспроизведения необходимо обработать здесь,
        // поскольку вызов запускается из отложенного callback.
        try {
            await player.play();
        } catch (error) {
            player.emit("player/error", player, `[QueueController] Failed to restore playback for guild ${interaction.guildId}: ${error}`, null);
            console.error(`[QueueController] Failed to restore playback for guild ${interaction.guildId}:`, error);
        }

        // Обновляем привязку сообщения, только если канал изменился.
        if (queue.message.channel_id !== interaction.channelId) {
            queue.message = new QueueMessage(interaction);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера - 1 очередь и плеер
 * @class ControllerQueues
 * @public
 */
export class ControllerQueues<T extends Queue = Queue>
    extends BaseQueueController<T> {
    /**
     * Настройки обработки аудио и воспроизведения.
     *
     * Значения считываются из конфигурации при создании экземпляра.
     * Изменение свойств во время работы контроллера влияет только
     * на те операции, которые повторно обращаются к этим свойствам.
     */
    public readonly options = {
        /**
         * Длительность оптимизационного интервала.
         */
        optimization: parseInt(
            env.get("duration.optimization", "15"),
            10
        ),

        /**
         * Громкость по умолчанию.
         */
        volume: parseInt(
            env.get("audio.volume", "70"),
            10
        ),

        /**
         * Длительность перехода между треками.
         */
        swapFade: parseInt(
            env.get("audio.swap.fade", "5"),
            10
        ),

        /**
         * Длительность затухания аудио.
         */
        fade: parseInt(
            env.get("audio.fade", "10"),
            10
        ),

        /**
         * Режим повторного воспроизведения.
         *
         * Значение 1 используется контроллером для выбора
         * последнего элемента очереди при восстановлении.
         */
        replay: parseInt(
            env.get("replay.type", "1"),
            10
        )
    };
}

/**
 * @author SNIPPIK
 * @description События глобальной системы очередей
 * @interface QueueEvents
 * @public
 */
export interface QueueEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param queue      - Очередь сервера
     * @param user       - Пользователь включивший трек
     * @param items      - Трек или плейлист, альбом
     * @returns void
     * @readonly
     */
    readonly "message/push": (msg: CycleInteraction, queue: Queue, items: Track | APIRequestData.List<Track>) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "message/playing": (queue: Queue) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка
     * @returns void
     * @readonly
     */
    readonly "message/error": (queue: Queue, error?: string | Error, position?: number) => void;

    /**
     * @description Событие при котором очередь очищается и становится в режим ожидания, простым языком "player-end-playing"
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "queue/cleanup": (queue: Queue) => void;

    /**
     * @description Событие при котором очередь полностью удаляется со всеми компонентами
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "queue/destroy": (queue: Queue) => void;
}