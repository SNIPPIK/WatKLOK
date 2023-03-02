[<img align="right" alt="Avatar bot" width="350px" src="https://media.discordapp.net/attachments/1016995045783633940/1080964769927942234/Icon.png" />](https://discordapp.com/users/623170593268957214)
# WatKLOK
- Автор: [`SNIPPIK`](https://github.com/SNIPPIK)
- Лицензия: [`WatKLOK LICENSE`](LICENSE.md)
- Перейти к [`настройкам`](db/Config.json)
- Перейти к [`командам`](src/Handler/Commands) | `Slash + Standart`
- Перейти к [`плееру`](src/AudioPlayer)
- Перейди к [`демонстрации`](https://www.youtube.com/watch?v=ncvpyWaxycw)
- Все сообщения удаляются автоматически через время

<img align="center" alt="PGI Settings" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/PGI.png?raw=true" />

<img align="center" alt="Bot Permissions" width="1000px" src="https://github.com/SNIPPIK/WatKLOK/blob/v2/.github/resource/Bot Permissions.png?raw=true" />

## Гайд по запуску
1. [`Node.js`](https://nodejs.org/ru/) 18-19
2. [`FFmpeg & FFprobe`](https://ffmpeg.org/) или npm install (ffmpeg-static и ffprobe-static)
3. Запускаем `npm run build`
4. Указываем данные в [`build/.env`](build/.env) | `Ps если его нет, то надо создать`
5. Варианты запуска | `Если возникли ошибки повторите шаги заново`
   - Если серверов не более 1к, то `npm run start`
   - Если серверов более 1к, то `npm run sharder`

## Поддерживаемые платформы
[Можно добавить поддержку иных платформ](src/AudioPlayer/Structures/Platform.ts)

|Теги| Платформы                                    | Что доступно                                      | Аудио                    | Доступ без авторизации |
|----|----------------------------------------------|---------------------------------------------------|--------------------------|------------------------|
| YT | [**YouTube**](https://www.youtube.com/)      | **видео, плейлисты, поиск, стримы, каналы**  | ✔                        | ✔                     |
| SP | [**Spotify**](https://open.spotify.com/)     | **треки, плейлисты, поиск, альбомы, авторы** | ✔ (YM, YT)               | ❌                    |
| YM | [**Yandex Music**](https://music.yandex.ru/) | **треки, альбомы, поиск, авторы**            | ✔                        | ❌                    |
| SC | [**SoundCloud**](https://soundcloud.com/)    | **треки, плейлисты, поиск, альбомы**         | ✔                        | ✔                     |
| VK | [**VK**](https://vk.com/)                    | **треки, ~~плейлисты~~, поиск**              | ✔                        | ❌                    |
| D  | [**Discord**](https://discord.com/)           | **ссылки, файлы**                            | ✔                        | ✔                     |

<details>
  <summary>Показать настройки</summary>

### Настройки
1. [`.env`](.env) | для не публичных данных
   ```dotenv
    TOKEN="" #Discord bot token
    SPOTIFY_ID="" #Spotify client id
    SPOTIFY_SECRET="" #Spotify client secket
    SOUNDCLOUD="" #Soundcloud client id
    VK_TOKEN="" #Vk auth token (user token, not a bot token)
    YANDEX="" #Ссылка для получения токена https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d
   ```
2. [`Cookie.json`](db/Cookie.json) | необходим для снятия ограничений **YouTube**
    ```json5
   {
      "Cookie": ""
   }
   ```
3. [`Config.json`](db/Config.json) | основные настройки
   ```json5
   {
      "APIs": {
         //Лимиты размеров (плейлиста, поиска, топ треков автора)
         "limits": {
            "playlist": 50, //playlist, album
            "search": 5, //Рекомендуется 5
            "author": 5
         },

        //Отображать ошибки запросов платформ (ошибки будут видны только в консоли)
        "showErrors": false,
        
        //Отправлять сообщения об ошибках (ошибки будут видны в канале если он указан Channels.sendErrors)
        "sendErrors": false,
      
        //Отображать сообщение о том что нет поддержки аудио у платформ указанных в SongSupport<PlatformsAudio>
        "showWarningAudio": true
      },
      "Channels": {
        //ID канала на который будут отображаться ошибки
        "sendErrors": "",
   
        //ID канала на котором будут отображаться пользователи покинувшие сервер
        "removeUser": ""
      },
      "Bot": {
         "ignoreErrors": true, //Игнорировать ошибки
         "prefix": "!", //Префикс
         "OwnerIDs": [], //Пользователи у которых есть доступ к разделу Owner

         //Бот будет делать вид, что пишет в текстовый канал
         "TypingMessage": true
      },
      //Режим отладки
      "Debug": false,
      //[Beta] Режим общей обработки (все команды, некторые функции будут обрабатыватся постепенно)
      "QueueCallbacks": true,

      //Настройки музыки
      "Music": {
         "CacheMusic": false, //Кешировать музыку? (Значительно ускоряет работу фильтров и seek, как уменьшает кол-во запросов на сервера), могут быть ошибки c seek
         "CacheDir": "AudioCache", //Путь, где будет сохраниться кеш музыки

         //Отправить ли сообщение о том что производится запрос на <platform>.<type>
         //Параметр игнорирует что в APIs<showWarningAudio>. Если этот параметр выключен, то showWarningAudio будет неактивен независимо от аргумента
         "showGettingData": false,
   
         //Настройки плеера
         "AudioPlayer": {
            "methodSendPackets": "djs", //Каким образом отправлять пакеты (старым способом - djs, новым способом - new)
   
            "sendDuration": 20, //Задержка до начала отправления пакетов
            "updateMessage": 15 //С какой скоростью обновлять сообщение (текущий трек или сейчас играет)
         },
          //Прогресс бар текущего трека
         "ProgressBar": {
            "enable": true, //Состояние (отображать или не отображать)
            "empty": "─", //После точки будет идти empty
            "full": "─", //До точки будет идти full
            "button": "⚪" //Сама точка
         },
         //Настройки аудио
         "Audio": {
             "bitrate": "256k" //Битрейт аудио
         },
        //Если у трека, плейлиста, альбома нет картинки будет выбрана _found или _image
        //Если автор трека верифицированный то будет выбрана ver, если нет то _ver
        "images": {
            "ver": "https://media.discordapp.net/attachments/815897363188154408/1028014390299082852/Ok.png",
            "_ver": "https://media.discordapp.net/attachments/815897363188154408/1028014389934174308/Not.png",
            "_found": "https://media.discordapp.net/attachments/815897363188154408/1028014390752055306/WTF.png",
            "_image": "https://media.discordapp.net/attachments/815897363188154408/1028014391146328124/MusciNote.png"
        },
        //Кнопки под сообщение о текущем треке
        //Вариации [{id: "ID emoji"}] или [{name: "emoji"}]
        //Поддержка больших кол-во кнопок будет введена позже
        "Buttons": [
            { "name": "⏪" }, { "name": "⏯" }, { "name": "⏩" }, { "name": "🔃" }
        ]
      },

      //Настройка меню
      "ReactionMenuSettings": {
         "emojis": {
            "back": "⬅️", //Кнопка назад
            "next": "➡️", //Кнопка вперед
            "cancel": "❌" //Удаление меню
         }
      },
   
      //Для голосования (по типу skip, remove, seek)
      "Voting": ["✅", "❌"]
   }
   ```
4. [`Filters.json`](db/Filters.json) | Можно добавлять свои фильтры в конфиг | [`FFmpeg Docs`](https://ffmpeg.org/ffmpeg.html)
    ```json5
   [
      {
         "names": ["name"], //Названия
         "description": "Типа описание", //Описание

         //Сам аргумент, если указывать args то необходимо что-бы в конце аргумента было =
         //Пример atempo=
         "filter": "Аргумент для FFmpeg",

         //Мин, макс - мин и макс аргументы для фильтра
         //Если аргумент не нужен, оставить false
         "args": [1, 3],

         //Ускоряется ли музыка, да то как (arg - ускоряется аргументом, 1.25 - ускоряется в 1.25)
         //Влияет на progress bar
         "speed": "arg"
      }
   ]
     ```
</details>
