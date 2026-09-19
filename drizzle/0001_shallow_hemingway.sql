CREATE TABLE `assessmentResponses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assessmentId` int NOT NULL,
	`code` varchar(8) NOT NULL,
	`dimension` varchar(80) NOT NULL,
	`criterion` text NOT NULL,
	`evidenceExpected` text NOT NULL,
	`score` int,
	`evidenceObserved` text,
	`gap` text,
	`responsible` varchar(180),
	`dueDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assessmentResponses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`status` enum('draft','active','completed') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`assessedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assessments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `initiatives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`assessmentId` int,
	`name` varchar(180) NOT NULL,
	`dimension` varchar(80) NOT NULL,
	`criterionCode` varchar(8),
	`problem` text,
	`minimumProduct` text,
	`owner` varchar(180),
	`valueScore` int,
	`riskScore` int,
	`urgencyScore` int,
	`feasibilityScore` int,
	`dependencyScore` int,
	`priorityScore` int,
	`status` enum('not_started','in_progress','blocked','completed','cancelled') NOT NULL DEFAULT 'not_started',
	`dueDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `initiatives_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kpis` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`code` varchar(12) NOT NULL,
	`name` varchar(180) NOT NULL,
	`definition` text,
	`currentValue` int,
	`targetValue` int,
	`unit` varchar(24),
	`trend` enum('improving','stable','declining','no_data') NOT NULL DEFAULT 'no_data',
	`decisionTrigger` text,
	`decision` text,
	`measuredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kpis_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organizationMembers` (
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','contributor','viewer') NOT NULL DEFAULT 'contributor',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organizationMembers_organizationId_userId_pk` PRIMARY KEY(`organizationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(180) NOT NULL,
	`acronym` varchar(32),
	`description` text,
	`ownerId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `risks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`cause` text,
	`effect` text,
	`probability` int,
	`impact` int,
	`exposure` int,
	`response` text,
	`owner` varchar(180),
	`status` enum('open','mitigated','accepted','closed') NOT NULL DEFAULT 'open',
	`dueDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `risks_id` PRIMARY KEY(`id`)
);
