pub mod discord_opcode {
    // =====================================================================
    // Main Discord Gateway
    // Основное WebSocket-соединение Discord Gateway.
    // =====================================================================

    pub mod gateway {
        /// Запрос на вход, выход или перемещение между голосовыми каналами.
        ///
        /// Используется исключительно в основном Discord Gateway,
        /// а не в Voice Gateway.
        pub const VOICE_STATE_UPDATE: u64 = 4;
    }

    // =====================================================================
    // Discord Voice Gateway
    // WebSocket-соединение с голосовым сервером Discord.
    // =====================================================================

    pub mod voice {
        /// Идентификация клиента в Voice Gateway.
        ///
        /// Первое сообщение клиента после открытия WebSocket.
        /// Содержит server_id, session_id, user_id и token.
        pub const IDENTIFY: u64 = 0;

        /// Выбор голосового протокола и режима шифрования.
        ///
        /// Отправляется клиентом после READY и UDP discovery.
        /// Передаёт внешний IP, порт, выбранный протокол и режим шифрования.
        pub const SELECT_PROTOCOL: u64 = 1;

        /// Данные для установления UDP-соединения.
        ///
        /// Отправляется сервером после IDENTIFY.
        /// Содержит SSRC, IP, порт и доступные режимы шифрования.
        pub const READY: u64 = 2;

        /// Heartbeat для поддержания Voice Gateway WebSocket.
        ///
        /// Интервал определяется полем heartbeat_interval из HELLO.
        /// В Voice Gateway v8 поле seq_ack содержит sequence number
        /// последнего полученного пронумерованного сообщения сервера.
        pub const HEARTBEAT: u64 = 3;

        /// Описание установленной голосовой сессии.
        ///
        /// Отправляется сервером после SELECT_PROTOCOL.
        /// Содержит режим шифрования, secret_key и, при использовании
        /// DAVE, dave_protocol_version.
        pub const SESSION_DESCRIPTION: u64 = 4;

        /// Состояние говорящего.
        ///
        /// Используется клиентом и сервером.
        /// Содержит speaking (битовую маску), delay и ssrc.
        pub const SPEAKING: u64 = 5;

        /// Подтверждение heartbeat.
        ///
        /// Отправляется сервером в ответ на HEARTBEAT.
        pub const HEARTBEAT_ACK: u64 = 6;

        /// Возобновление ранее установленной голосовой сессии.
        ///
        /// Отправляется клиентом при восстановлении соединения,
        /// если доступен механизм Resume.
        pub const RESUME: u64 = 7;

        /// Приветствие Voice Gateway.
        ///
        /// Отправляется сервером и содержит heartbeat_interval
        /// в миллисекундах.
        pub const HELLO: u64 = 8;

        /// Подтверждение успешного возобновления сессии.
        ///
        /// Отправляется сервером в ответ на RESUME.
        pub const RESUMED: u64 = 9;

        /// Уведомление о подключении одного или нескольких участников.
        ///
        /// Отправляется сервером. Содержит user_ids.
        /// Используется, в частности, при координации участников DAVE.
        pub const CLIENTS_CONNECT: u64 = 11;

        /// Уведомление об отключении участника от голосовой сессии.
        ///
        /// Отправляется сервером. Содержит user_id.
        /// Используется при синхронизации состава MLS-группы DAVE.
        pub const CLIENT_DISCONNECT: u64 = 13;
    }

    // =====================================================================
    // DAVE — Discord Audio & Video End-to-End Encryption
    // Расширение протокола Voice Gateway для MLS и E2EE.
    // =====================================================================

    pub mod dave {
        /// Подготовка перехода между версиями протокола DAVE.
        ///
        /// Сервер объявляет предстоящий переход.
        /// При transition_id == 0 переход может выполняться немедленно
        /// в соответствии с правилами протокола.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_PREPARE_TRANSITION: u64 = 21;

        /// Выполнение подготовленного перехода.
        ///
        /// Сервер сообщает, что переход с указанным transition_id
        /// необходимо выполнить.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_EXECUTE_TRANSITION: u64 = 22;

        /// Подтверждение готовности к переходу.
        ///
        /// Клиент сообщает серверу, что готов выполнить переход
        /// с указанным transition_id.
        ///
        /// Официальное имя протокола: dave_protocol_ready_for_transition.
        ///
        /// Направление: клиент -> сервер.
        pub const DAVE_TRANSITION_READY: u64 = 23;

        /// Подготовка эпохи MLS и объявление версии протокола.
        ///
        /// Сервер передаёт epoch и protocol_version.
        /// При epoch == 1 требуется создать или пересоздать MLS-группу
        /// и подготовить новый key package.
        ///
        /// Официальное имя протокола: dave_protocol_prepare_epoch.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_PREPARE_EPOCH: u64 = 24;

        /// Пакет внешнего отправителя MLS.
        ///
        /// Содержит данные внешнего отправителя Voice Gateway,
        /// необходимые для расширений MLS-группы.
        ///
        /// Официальное имя протокола: dave_mls_external_sender_package.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_MLS_EXTERNAL_SENDER: u64 = 25;

        /// MLS Key Package клиента.
        ///
        /// Используется сервером при добавлении клиента в MLS-группу.
        /// При определённых событиях инициализации пакет необходимо
        /// сформировать и отправить повторно.
        ///
        /// Направление: клиент -> сервер.
        pub const DAVE_MLS_KEY_PACKAGE: u64 = 26;

        /// Предложения об изменении состава MLS-группы.
        ///
        /// Может включать предложения добавления и удаления участников.
        /// Клиент обрабатывает предложения в соответствии с правилами MLS.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_MLS_PROPOSALS: u64 = 27;

        /// Передача MLS Commit и, при необходимости, Welcome.
        ///
        /// Используется участником, выполняющим commit.
        /// Welcome включается, когда commit содержит добавление участников.
        ///
        /// Направление: клиент -> сервер.
        pub const DAVE_MLS_COMMIT_WELCOME: u64 = 28;

        /// Рассылка принятого MLS Commit с идентификатором перехода.
        ///
        /// Сервер передаёт commit остальным участникам, чтобы они
        /// могли обновить состояние MLS-группы и подготовиться к переходу.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_MLS_ANNOUNCE_COMMIT_TRANSITION: u64 = 29;

        /// MLS Welcome для добавляемого участника.
        ///
        /// Позволяет участнику присоединиться к существующей MLS-группе.
        ///
        /// Направление: сервер -> клиент.
        pub const DAVE_MLS_WELCOME: u64 = 30;

        /// Уведомление о невалидном Commit или Welcome.
        ///
        /// Клиент сообщает, что получил сообщение Commit или Welcome,
        /// которое не удалось обработать.
        /// Сервер использует это событие для восстановления MLS-группы.
        ///
        /// Направление: клиент -> сервер.
        pub const DAVE_MLS_INVALID_COMMIT_WELCOME: u64 = 31;

        /// Проверяет, является ли opcode известным DAVE opcode.
        ///
        /// Используется для маршрутизации сообщений Voice Gateway
        /// в обработчик DAVE.
        ///
        /// Проверяются только известные константы: новые opcode
        /// необходимо добавлять явно после проверки спецификации.
        #[inline]
        pub const fn is_dave(code: u64) -> bool {
            matches!(
                code,
                DAVE_PREPARE_TRANSITION
                    | DAVE_EXECUTE_TRANSITION
                    | DAVE_TRANSITION_READY
                    | DAVE_PREPARE_EPOCH
                    | DAVE_MLS_EXTERNAL_SENDER
                    | DAVE_MLS_KEY_PACKAGE
                    | DAVE_MLS_PROPOSALS
                    | DAVE_MLS_COMMIT_WELCOME
                    | DAVE_MLS_ANNOUNCE_COMMIT_TRANSITION
                    | DAVE_MLS_WELCOME
                    | DAVE_MLS_INVALID_COMMIT_WELCOME
            )
        }

        #[cfg(test)]
        mod tests {
            use super::*;

            #[test]
            fn dave_opcodes_are_correct() {
                assert_eq!(DAVE_PREPARE_TRANSITION, 21);
                assert_eq!(DAVE_EXECUTE_TRANSITION, 22);
                assert_eq!(DAVE_TRANSITION_READY, 23);
                assert_eq!(DAVE_PREPARE_EPOCH, 24);
                assert_eq!(DAVE_MLS_EXTERNAL_SENDER, 25);
                assert_eq!(DAVE_MLS_KEY_PACKAGE, 26);
                assert_eq!(DAVE_MLS_PROPOSALS, 27);
                assert_eq!(DAVE_MLS_COMMIT_WELCOME, 28);
                assert_eq!(DAVE_MLS_ANNOUNCE_COMMIT_TRANSITION, 29);
                assert_eq!(DAVE_MLS_WELCOME, 30);
                assert_eq!(DAVE_MLS_INVALID_COMMIT_WELCOME, 31);
            }

            #[test]
            fn is_dave_recognizes_known_opcodes() {
                for code in DAVE_PREPARE_TRANSITION..=DAVE_MLS_INVALID_COMMIT_WELCOME {
                    assert!(
                        is_dave(code),
                        "Opcode {code} must be recognized as DAVE"
                    );
                }
            }

            #[test]
            fn is_dave_rejects_non_dave_opcodes() {
                assert!(!is_dave(0));
                assert!(!is_dave(20));
                assert!(!is_dave(32));
                assert!(!is_dave(255));
            }
        }
    }

    // =====================================================================
    // Общие тесты разделения пространств opcode.
    // =====================================================================

    #[cfg(test)]
    mod tests {
        use super::{gateway, voice};

        #[test]
        fn gateway_and_voice_opcodes_are_separate() {
            // Одинаковое значение, но разные WebSocket-протоколы.
            assert_eq!(gateway::VOICE_STATE_UPDATE, 4);
            assert_eq!(voice::SESSION_DESCRIPTION, 4);
        }

        #[test]
        fn voice_opcodes_are_correct() {
            assert_eq!(voice::IDENTIFY, 0);
            assert_eq!(voice::SELECT_PROTOCOL, 1);
            assert_eq!(voice::READY, 2);
            assert_eq!(voice::HEARTBEAT, 3);
            assert_eq!(voice::SPEAKING, 5);
            assert_eq!(voice::HEARTBEAT_ACK, 6);
            assert_eq!(voice::RESUME, 7);
            assert_eq!(voice::HELLO, 8);
            assert_eq!(voice::RESUMED, 9);
            assert_eq!(voice::CLIENTS_CONNECT, 11);
            assert_eq!(voice::CLIENT_DISCONNECT, 13);
        }
    }
}