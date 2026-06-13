# 齐鲁工业大学图书馆座位预约助手

这是一个本地运行的齐鲁工业大学图书馆座位预约工具，支持两种使用方式：

- 网页控制台：推荐小白使用，有界面，可以登录、查询座位、选择座位、提交预约、定时预约。
- CMD 命令行：保留原版命令行流程，适合习惯终端操作的人。

项目只在你的电脑本地运行，不需要部署服务器。

## 重要提醒

本项目会在本地保存这些文件：

```text
.qlu-credentials.json      明文保存你的学号和密码
.qlu-token.json            保存登录 token
.cas-browser-profile/      保存 CAS 登录浏览器会话
```

`.qlu-credentials.json` 是明文文件，请不要发给别人，也不要上传到 GitHub。项目已经在 `.gitignore` 里忽略它。

## 一、安装运行环境

### 1. 安装 Node.js

需要 Node.js 20 或更高版本。

检查是否已安装：

```powershell
node -v
npm -v
```

如果提示找不到 `node` 或 `npm`，请安装 Node.js 20+，安装完成后重新打开 PowerShell。

### 2. 安装 Python

需要 Python 3.10 或更高版本。

检查是否已安装：

```powershell
python --version
```

如果提示找不到 `python`，请先安装 Python，并勾选 `Add Python to PATH`。

### 3. 安装 Playwright

CAS 自动登录需要 Playwright 控制浏览器。

```powershell
pip install playwright
python -m playwright install chromium
```

如果你使用 Anaconda，也可以在 Anaconda Prompt 里执行上面的命令。

## 二、进入项目目录

打开 PowerShell，进入本项目文件夹：

```powershell
cd 你的项目目录\QLU-LIB
```

确认当前目录里有这些文件：

```powershell
dir
```

你应该能看到：

```text
cli.js
server.js
cas_token_helper.py
package.json
frontend
```

## 三、配置账号密码

项目使用 `.qlu-credentials.json` 保存账号密码，用于无人值守自动刷新 token。

### 1. 复制示例文件

```powershell
Copy-Item .qlu-credentials.example.json .qlu-credentials.json
```

### 2. 打开配置文件

```powershell
notepad .qlu-credentials.json
```

### 3. 填入你的账号密码

把内容改成这样：

```json
{
  "username": "你的学号",
  "password": "你的密码"
}
```

保存并关闭记事本。

注意：这个文件是明文保存密码，只适合放在你自己的电脑上。

## 四、启动网页控制台

推荐使用网页控制台：

```powershell
npm run ui
```

看到类似输出后，不要关闭这个窗口：

```text
QLU-LIB 网页控制台已启动：http://127.0.0.1:5500
```

然后打开浏览器访问：

```text
http://127.0.0.1:5500
```

建议使用 `127.0.0.1`，不要用 `localhost`，因为部分 Windows 环境里 `localhost` 可能进错旧服务。

## 五、第一次登录

打开网页后，先看顶部登录状态。

如果显示未登录：

1. 点击页面里的 `打开 CAS 登录`。
2. 程序会自动打开学校统一身份认证页面。
3. 如果你已经配置了 `.qlu-credentials.json`，程序会自动填账号密码并登录。
4. 登录成功后，会自动保存 token 到 `.qlu-token.json`。

如果学校要求验证码、短信、人脸或其他二次验证，需要你手动完成。程序不会绕过学校安全验证。

## 六、预约座位

登录成功后，页面会自动加载：

- 可预约日期
- 楼层
- 区域
- 座位图

操作流程：

1. 选择预约日期。
2. 选择楼层。
3. 选择区域。
4. 在座位图里选择一个空闲座位。
5. 右侧确认预约参数。
6. 点击 `提交预约`。

座位很多时，座位图会固定在一个框内，可以在框里上下滚动选择座位。

## 七、定时预约

如果你想在某个时间自动提交：

1. 先选择座位。
2. 在右侧切换到 `定时预约`。
3. 设置执行时间。
4. 设置重试次数和间隔秒数。
5. 点击 `创建定时任务`。

定时任务要求本地服务一直运行，也就是启动 `npm run ui` 的 PowerShell 窗口不能关闭。

## 八、自动更新 token

学校 token 自带过期时间，不能永久延长。

本项目的处理方式是：

- token 保存到 `.qlu-token.json`
- 服务启动时自动读取 token
- token 快过期前自动重新登录获取新 token
- 默认提前约 15 分钟刷新
- 刷新成功后自动覆盖 `.qlu-token.json`

页面会显示：

```text
token 可用
保存时间
有效期至
剩余时间
无人值守登录已配置：项目凭据文件
```

如果想手动测试刷新，可以在服务运行时执行：

```powershell
node -e "fetch('http://127.0.0.1:5500/api/token/refresh',{method:'POST'}).then(r=>r.text()).then(console.log)"
```

如果返回里有：

```json
"tokenReady": true
```

说明刷新成功。

## 九、CMD 命令行版本

如果你想使用原来的 CMD 方式：

```powershell
npm start
```

或者双击：

```text
QLU-LIB-CMD.bat
```

命令行版本会按提示一步一步选择日期、楼层、区域和座位。

## 十、常用命令

启动网页控制台：

```powershell
npm run ui
```

启动 CMD 版本：

```powershell
npm start
```

单独打开 CAS 获取 token：

```powershell
npm run token
```

检查 Node 版本：

```powershell
node -v
```

检查 Python 版本：

```powershell
python --version
```

## 十一、常见问题

### 1. 网页打不开

先确认服务是否启动：

```powershell
npm run ui
```

然后访问：

```text
http://127.0.0.1:5500
```

不要关闭运行 `npm run ui` 的 PowerShell 窗口。

### 2. 提示缺少 Playwright

执行：

```powershell
pip install playwright
python -m playwright install chromium
```

### 3. 自动登录失败

检查 `.qlu-credentials.json`：

```powershell
notepad .qlu-credentials.json
```

确认格式正确：

```json
{
  "username": "你的学号",
  "password": "你的密码"
}
```

如果学校出现验证码或二次验证，需要手动完成。

### 4. token 过期

正常情况下项目会自动刷新 token。

如果刷新失败，可以手动点击网页里的 `重新登录`，或者运行：

```powershell
npm run token
```

### 5. 端口被占用

默认端口是 `5500`。如果启动失败，先关掉之前运行的窗口，或者在 PowerShell 里查找 Node 进程：

```powershell
Get-Process node
```

结束多余的 Node 进程：

```powershell
Stop-Process -Name node
```

然后重新启动：

```powershell
npm run ui
```

### 6. 不想保存账号密码

删除这个文件即可：

```powershell
Remove-Item .qlu-credentials.json
```

之后 token 过期时需要你手动登录。

## 十二、不要上传的文件

这些文件包含个人登录状态或账号信息，不要上传：

```text
.qlu-credentials.json
.qlu-token.json
.cas-browser-profile/
```

项目已经通过 `.gitignore` 忽略它们。

## 十三、项目文件说明

```text
cli.js                         原 CMD 预约逻辑
server.js                      网页控制台后端服务
cas_token_helper.py            CAS 登录和 token 获取工具
frontend/index.html            网页界面
frontend/styles.css            网页样式
frontend/app.js                网页交互逻辑
package.json                   项目命令
QLU-LIB-CMD.bat                双击运行 CMD 版本
.qlu-credentials.example.json  账号密码配置示例
```

## 十四、推荐使用方式

每天使用时按这个顺序：

1. 打开 PowerShell。
2. 进入项目目录。
3. 运行 `npm run ui`。
4. 打开 `http://127.0.0.1:5500`。
5. 选择座位并预约。

只要服务窗口不关闭，token 会自动刷新，定时任务也会继续执行。
