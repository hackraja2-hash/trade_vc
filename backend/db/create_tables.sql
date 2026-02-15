-- create_tables.sql

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[roles]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[roles] (
    [id] INT IDENTITY(1,1) PRIMARY KEY,
    [role_name] NVARCHAR(100) NOT NULL UNIQUE,
    [module_access_json] NVARCHAR(MAX) NOT NULL,
    [created_by] INT NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[users]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[users] (
    [id] INT IDENTITY(1,1) PRIMARY KEY,
    [username] NVARCHAR(100) NOT NULL UNIQUE,
    [password_hash] NVARCHAR(255) NOT NULL,
    [user_type] NVARCHAR(20) NOT NULL DEFAULT 'normal',
    [status] NVARCHAR(20) NOT NULL DEFAULT 'active',
    [role_id] INT NULL,
    [full_name] NVARCHAR(200) NULL,
    [email] NVARCHAR(200) NULL,
    [phone] NVARCHAR(50) NULL,
    [address] NVARCHAR(500) NULL,
    [pancard_no] NVARCHAR(30) NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_users_type CHECK ([user_type] IN ('normal', 'admin', 'superadmin')),
    CONSTRAINT CK_users_status CHECK ([status] IN ('active', 'inactive')),
    CONSTRAINT FK_users_role FOREIGN KEY ([role_id]) REFERENCES [dbo].[roles]([id])
  );
END

IF COL_LENGTH('dbo.users', 'password_hash') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD password_hash NVARCHAR(255) NULL;
  IF COL_LENGTH('dbo.users', 'PasswordHash') IS NOT NULL
    EXEC('UPDATE dbo.users SET password_hash = [PasswordHash] WHERE password_hash IS NULL');
END

IF COL_LENGTH('dbo.users', 'user_type') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD user_type NVARCHAR(20) NOT NULL CONSTRAINT DF_users_user_type DEFAULT 'normal';
  IF COL_LENGTH('dbo.users', 'Role') IS NOT NULL
    EXEC('UPDATE dbo.users SET user_type = CASE LOWER([Role]) WHEN ''superadmin'' THEN ''superadmin'' WHEN ''admin'' THEN ''admin'' ELSE ''normal'' END');
END

IF COL_LENGTH('dbo.users', 'status') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD status NVARCHAR(20) NOT NULL CONSTRAINT DF_users_status DEFAULT 'active';
  IF COL_LENGTH('dbo.users', 'Status') IS NOT NULL
    EXEC('UPDATE dbo.users SET status = CASE WHEN LOWER([Status]) IN (''inactive'',''disabled'',''blocked'') THEN ''inactive'' ELSE ''active'' END');
END

IF COL_LENGTH('dbo.users', 'role_id') IS NULL
  ALTER TABLE dbo.users ADD role_id INT NULL;

IF COL_LENGTH('dbo.users', 'full_name') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD full_name NVARCHAR(200) NULL;
  IF COL_LENGTH('dbo.users', 'FullName') IS NOT NULL
    EXEC('UPDATE dbo.users SET full_name = [FullName] WHERE full_name IS NULL');
END

IF COL_LENGTH('dbo.users', 'email') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD email NVARCHAR(200) NULL;
  IF COL_LENGTH('dbo.users', 'Email') IS NOT NULL
    EXEC('UPDATE dbo.users SET email = [Email] WHERE email IS NULL');
END

IF COL_LENGTH('dbo.users', 'phone') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD phone NVARCHAR(50) NULL;
  IF COL_LENGTH('dbo.users', 'Phone') IS NOT NULL
    EXEC('UPDATE dbo.users SET phone = [Phone] WHERE phone IS NULL');
END

IF COL_LENGTH('dbo.users', 'address') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD address NVARCHAR(500) NULL;
  IF COL_LENGTH('dbo.users', 'Address') IS NOT NULL
    EXEC('UPDATE dbo.users SET address = [Address] WHERE address IS NULL');
END

IF COL_LENGTH('dbo.users', 'pancard_no') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD pancard_no NVARCHAR(30) NULL;
  IF COL_LENGTH('dbo.users', 'PanCard') IS NOT NULL
    EXEC('UPDATE dbo.users SET pancard_no = [PanCard] WHERE pancard_no IS NULL');
END

IF COL_LENGTH('dbo.users', 'created_at') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created_at DEFAULT SYSUTCDATETIME();
  IF COL_LENGTH('dbo.users', 'CreatedAt') IS NOT NULL
    EXEC('UPDATE dbo.users SET created_at = [CreatedAt]');
END

IF COL_LENGTH('dbo.users', 'updated_at') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD updated_at DATETIME2 NOT NULL CONSTRAINT DF_users_updated_at DEFAULT SYSUTCDATETIME();
  EXEC('UPDATE dbo.users SET updated_at = created_at WHERE updated_at IS NULL');
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[connection_configs]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[connection_configs] (
    [id] INT IDENTITY(1,1) PRIMARY KEY,
    [connection_name] NVARCHAR(100) NOT NULL UNIQUE,
    [db_type] NVARCHAR(20) NOT NULL,
    [host] NVARCHAR(255) NOT NULL,
    [port] INT NOT NULL,
    [database_name] NVARCHAR(255) NOT NULL,
    [username] NVARCHAR(255) NOT NULL,
    [auth_type] NVARCHAR(20) NOT NULL DEFAULT 'sql',
    [encrypted_password] NVARCHAR(MAX) NOT NULL,
    [encrypt_connection] BIT NOT NULL DEFAULT 0,
    [is_active] BIT NOT NULL DEFAULT 0,
    [status] NVARCHAR(20) NOT NULL DEFAULT 'stopped',
    [created_by] INT NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_connection_db_type CHECK ([db_type] IN ('local', 'azure')),
    CONSTRAINT CK_connection_auth_type CHECK ([auth_type] IN ('windows', 'sql')),
    CONSTRAINT CK_connection_status CHECK ([status] IN ('active', 'stopped'))
  );
END

IF COL_LENGTH('dbo.connection_configs', 'auth_type') IS NULL
  ALTER TABLE dbo.connection_configs ADD auth_type NVARCHAR(20) NOT NULL CONSTRAINT DF_connection_auth_type DEFAULT 'sql';

EXEC('UPDATE dbo.connection_configs
SET auth_type = CASE WHEN auth_type IN (''windows'', ''sql'') THEN auth_type ELSE ''sql'' END;');

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[audit_logs]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[audit_logs] (
    [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [actor_user_id] INT NULL,
    [actor_user_type] NVARCHAR(20) NULL,
    [action] NVARCHAR(120) NOT NULL,
    [target_type] NVARCHAR(50) NULL,
    [target_id] NVARCHAR(120) NULL,
    [metadata_json] NVARCHAR(MAX) NULL,
    [ip_address] NVARCHAR(80) NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[portfolio]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[portfolio] (
    [id] INT IDENTITY(1,1) PRIMARY KEY,
    [user_id] INT NOT NULL,
    [symbol] NVARCHAR(50) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [avg_price] DECIMAL(18,6) NOT NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_portfolio_user FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id])
  );
END

IF COL_LENGTH('dbo.portfolio', 'user_id') IS NULL
BEGIN
  ALTER TABLE dbo.portfolio ADD user_id INT NULL;
  IF COL_LENGTH('dbo.portfolio', 'UserId') IS NOT NULL
    EXEC('UPDATE dbo.portfolio SET user_id = [UserId] WHERE user_id IS NULL');
END

IF COL_LENGTH('dbo.portfolio', 'symbol') IS NULL
BEGIN
  ALTER TABLE dbo.portfolio ADD symbol NVARCHAR(50) NULL;
  IF COL_LENGTH('dbo.portfolio', 'Symbol') IS NOT NULL
    EXEC('UPDATE dbo.portfolio SET symbol = [Symbol] WHERE symbol IS NULL');
END

IF COL_LENGTH('dbo.portfolio', 'quantity') IS NULL
BEGIN
  ALTER TABLE dbo.portfolio ADD quantity DECIMAL(18,6) NULL;
  IF COL_LENGTH('dbo.portfolio', 'Quantity') IS NOT NULL
    EXEC('UPDATE dbo.portfolio SET quantity = [Quantity] WHERE quantity IS NULL');
END

IF COL_LENGTH('dbo.portfolio', 'avg_price') IS NULL
BEGIN
  ALTER TABLE dbo.portfolio ADD avg_price DECIMAL(18,6) NULL;
  IF COL_LENGTH('dbo.portfolio', 'AvgPrice') IS NOT NULL
    EXEC('UPDATE dbo.portfolio SET avg_price = [AvgPrice] WHERE avg_price IS NULL');
END

IF COL_LENGTH('dbo.portfolio', 'created_at') IS NULL
BEGIN
  ALTER TABLE dbo.portfolio ADD created_at DATETIME2 NOT NULL CONSTRAINT DF_portfolio_created_at DEFAULT SYSUTCDATETIME();
  IF COL_LENGTH('dbo.portfolio', 'CreatedAt') IS NOT NULL
    EXEC('UPDATE dbo.portfolio SET created_at = [CreatedAt]');
END

EXEC('UPDATE dbo.portfolio
SET user_id = ISNULL(user_id, 0),
    symbol = ISNULL(symbol, ''UNKNOWN''),
    quantity = ISNULL(quantity, 0),
    avg_price = ISNULL(avg_price, 0)
WHERE user_id IS NULL OR symbol IS NULL OR quantity IS NULL OR avg_price IS NULL;');

IF OBJECT_ID(N'dbo.FK_portfolio_user', N'F') IS NULL
AND COL_LENGTH('dbo.portfolio', 'user_id') IS NOT NULL
BEGIN
  ALTER TABLE dbo.portfolio WITH NOCHECK
  ADD CONSTRAINT FK_portfolio_user FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]);
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[executions]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[executions] (
    [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [user_id] INT NOT NULL,
    [symbol] NVARCHAR(50) NOT NULL,
    [side] NVARCHAR(10) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [price] DECIMAL(18,6) NOT NULL,
    [position_type] NVARCHAR(20) NOT NULL DEFAULT 'longterm',
    [trade_source] NVARCHAR(20) NOT NULL DEFAULT 'manual',
    [charges] DECIMAL(18,6) NOT NULL DEFAULT 0,
    [adjustment_factor] DECIMAL(18,6) NULL,
    [executed_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_executions_side CHECK ([side] IN ('BUY', 'SELL')),
    CONSTRAINT CK_executions_position_type CHECK ([position_type] IN ('longterm', 'mtf')),
    CONSTRAINT CK_executions_trade_source CHECK ([trade_source] IN ('manual', 'algo')),
    CONSTRAINT FK_executions_user FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id])
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[portfolio_positions]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[portfolio_positions] (
    [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [user_id] INT NOT NULL,
    [symbol] NVARCHAR(50) NOT NULL,
    [position_type] NVARCHAR(20) NOT NULL,
    [quantity] DECIMAL(18,6) NOT NULL,
    [avg_buy_price] DECIMAL(18,6) NOT NULL,
    [effective_cost_per_share] DECIMAL(18,6) NOT NULL,
    [realized_pnl] DECIMAL(18,6) NOT NULL DEFAULT 0,
    [unrealized_pnl] DECIMAL(18,6) NOT NULL DEFAULT 0,
    [total_charges] DECIMAL(18,6) NOT NULL DEFAULT 0,
    [total_mtf_interest] DECIMAL(18,6) NOT NULL DEFAULT 0,
    [last_updated_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_positions_user_symbol_type UNIQUE ([user_id], [symbol], [position_type]),
    CONSTRAINT CK_positions_type CHECK ([position_type] IN ('longterm', 'mtf')),
    CONSTRAINT FK_positions_user FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id])
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[charges_config]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[charges_config] (
    [id] INT IDENTITY(1,1) PRIMARY KEY,
    [mtf_daily_interest_pct] DECIMAL(10,6) NOT NULL,
    [mtf_total_pct_type] NVARCHAR(20) NOT NULL DEFAULT 'simple',
    [mtf_leverage_multiplier] DECIMAL(10,4) NOT NULL DEFAULT 1,
    [effective_from] DATE NOT NULL,
    [is_active] BIT NOT NULL DEFAULT 1,
    [created_by] INT NULL,
    [created_at] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_charges_total_type CHECK ([mtf_total_pct_type] IN ('simple', 'compounded')),
    CONSTRAINT FK_charges_user FOREIGN KEY ([created_by]) REFERENCES [dbo].[users]([id])
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[market_ticks]') AND type = N'U')
BEGIN
  CREATE TABLE [dbo].[market_ticks] (
    [id] BIGINT IDENTITY(1,1) PRIMARY KEY,
    [symbol] NVARCHAR(50) NOT NULL,
    [ltp] DECIMAL(18,6) NOT NULL,
    [as_of] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END

IF NOT EXISTS (SELECT 1 FROM dbo.charges_config)
BEGIN
  INSERT INTO dbo.charges_config (mtf_daily_interest_pct, mtf_total_pct_type, mtf_leverage_multiplier, effective_from, is_active)
  VALUES (0.050000, 'simple', 2.0000, CAST(GETDATE() AS DATE), 1);
END

IF NOT EXISTS (SELECT 1 FROM dbo.roles WHERE role_name = 'default_normal_role')
BEGIN
  INSERT INTO dbo.roles (role_name, module_access_json)
  VALUES ('default_normal_role', '{"dashboard":true,"strategyBuilder":false,"tradeExecution":false,"reports":false,"userManagement":false}');
END

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE username = 'sa')
BEGIN
  EXEC('INSERT INTO dbo.users (username, password_hash, user_type, status)
  VALUES (''sa'', ''$2b$10$H44WdUSUY80BLcsxdhegkOY3yqBUZ0GIOthUPKVX/cLBqyca1GKEi'', ''superadmin'', ''active'');');
END

EXEC('UPDATE dbo.users
SET user_type = ''superadmin'', status = ''active''
WHERE username = ''sa'';');

EXEC('UPDATE dbo.users
SET username = ''sa'', user_type = ''superadmin'', status = ''active''
WHERE username = ''superadmin''
  AND NOT EXISTS (SELECT 1 FROM dbo.users WHERE username = ''sa'');');
