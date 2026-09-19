CREATE TABLE `auditLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`actorId` int NOT NULL,
	`action` varchar(80) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` int,
	`summary` varchar(500) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('deadline','invite','system') NOT NULL DEFAULT 'system',
	`title` varchar(180) NOT NULL,
	`message` text NOT NULL,
	`entityType` varchar(80),
	`entityId` int,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organizationInvites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','contributor','viewer') NOT NULL DEFAULT 'contributor',
	`token` varchar(96) NOT NULL,
	`invitedBy` int NOT NULL,
	`status` enum('pending','accepted','revoked') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organizationInvites_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizationInvites_token_unique` UNIQUE(`token`)
);
