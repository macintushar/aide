CREATE UNIQUE INDEX IF NOT EXISTS `messages_parent_message_id_unique` ON `messages` (`parent_message_id`);
