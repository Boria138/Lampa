const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require('electron');
const path = require('path');
const Store = require('electron-store').default;
const prompt = require('electron-prompt');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const { spawn } = require('child_process');

const store = new Store(); // Хранилище настроек

let mainWindow; // Главное окно приложения

const APP_CONFIG = {
    defaultUrl: 'http://lampa.mx', // Начальный URL
        minWidth: 1024,
        minHeight: 768,
        defaultWidth: 1366,
            defaultHeight: 768
};

// Создаем основное окно
function createWindow() {
    const savedBounds = store.get('windowBounds', {
        width: APP_CONFIG.defaultWidth,
        height: APP_CONFIG.defaultHeight,
        x: undefined,
        y: undefined
    });

    mainWindow = new BrowserWindow({
        width: savedBounds.width,
        height: savedBounds.height,
        x: savedBounds.x,
        y: savedBounds.y,
        minWidth: APP_CONFIG.minWidth,
        minHeight: APP_CONFIG.minHeight,
        icon: path.join(__dirname, '../assets/icon.png'),
                                   show: false, // Показываем окно позже
                                   webPreferences: {
                                       nodeIntegration: false,
                                       contextIsolation: true,
                                       enableRemoteModule: false,
                                       webSecurity: true,
                                       allowRunningInsecureContent: false,
                                       preload: path.join(__dirname, 'preload.js')
                                   },
                                   titleBarStyle: 'default',
                                   frame: true,
                                   autoHideMenuBar: false
    });

    // Настраиваем User-Agent
    const userAgent = `Lampa-Linux-Client/1.0.0 (Linux; ${process.arch}) Electron/${process.versions.electron}`;
    session.defaultSession.setUserAgent(userAgent);

    // Защита через Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ['default-src \'self\' \'unsafe-inline\' \'unsafe-eval\' data: https: http: wss: ws:']
            }
        });
    });

    // Загружаем стартовую страницу
    const startUrl = store.get('startUrl', APP_CONFIG.defaultUrl);
    mainWindow.loadURL(startUrl);

    // Показываем, когда готово
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (process.platform === 'linux') {
            mainWindow.focus(); // Фокус на Linux
        }
    });

    // Сохраняем размеры окна
    mainWindow.on('resize', () => {
        store.set('windowBounds', mainWindow.getBounds());
    });

    mainWindow.on('move', () => {
        store.set('windowBounds', mainWindow.getBounds());
    });

    mainWindow.on('closed', () => {
        mainWindow = null; // Очищаем при закрытии
    });

    // Открываем внешние ссылки в браузере
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Для разработчиков
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

// Создаем меню
function createMenu() {
    const template = [
        {
            label: 'Файл',
            submenu: [
                { label: 'Обновить', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
                { label: 'Перезагрузить без кэша', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
                { type: 'separator' },
                {
                    label: 'Сменить URL',
                    accelerator: 'CmdOrCtrl+,',
                    click: async () => {
                        const currentUrl = store.get('startUrl', APP_CONFIG.defaultUrl);
                        try {
                            const input = await prompt({
                                title: 'Сменить URL',
                                label: `Текущий URL: ${currentUrl}`,
                                value: currentUrl, // Начальное значение в поле ввода
                                inputAttrs: {
                                    type: 'url',
                                    placeholder: 'https://lampa.mx'
                                },
                                type: 'input',
                                width: 400,
                                height: 200
                            }, mainWindow);

                            if (input === null) {
                                // Пользователь нажал "Отмена"
                                return;
                            }

                            if (input) {
                                try {
                                    new URL(input); // Проверяем валидность URL
                                    store.set('startUrl', input);
                                    await dialog.showMessageBox(mainWindow, {
                                        type: 'info',
                                        title: 'Успех',
                                        message: `URL изменен на: ${input}`,
                                        buttons: ['OK']
                                    });
                                    mainWindow.loadURL(input);
                                } catch (err) {
                                    await dialog.showErrorBox('Ошибка', 'Неправильный URL! Введите корректный адрес.');
                                }
                            }
                        } catch (err) {
                            await dialog.showErrorBox('Ошибка', `Произошла ошибка: ${err.message}`);
                        }
                    }
                },
                { type: 'separator' },
                { label: 'Сохранить профиль', click: exportProfile },
                { label: 'Загрузить профиль', click: importProfile },
                { type: 'separator' },
                { label: 'Сбросить настройки', click: async () => {
                    store.clear();
                    await mainWindow.webContents.executeJavaScript('localStorage.clear();');
                    await dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'Сброс',
                        message: 'Настройки и локальное хранилище сброшены',
                        buttons: ['OK']
                    });
                    mainWindow.loadURL(APP_CONFIG.defaultUrl);
                }},
                { type: 'separator' },
                { label: 'Выход', accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q', click: () => app.quit() }
            ]
        },
        {
            label: 'Правка',
            submenu: [
                { role: 'undo', label: 'Отменить' },
                { role: 'redo', label: 'Повторить' },
                { type: 'separator' },
                { role: 'cut', label: 'Вырезать' },
                { role: 'copy', label: 'Копировать' },
                { role: 'paste', label: 'Вставить' },
                { role: 'selectall', label: 'Выделить все' }
            ]
        },
        {
            label: 'Вид',
            submenu: [
                { label: 'Полный экран', accelerator: 'F11', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
                { label: 'Увеличить', accelerator: 'CmdOrCtrl+Plus', click: () => {
                    const zoom = mainWindow?.webContents.getZoomLevel();
                    if (zoom) mainWindow.webContents.setZoomLevel(zoom + 0.5);
                }},
                { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', click: () => {
                    const zoom = mainWindow?.webContents.getZoomLevel();
                    if (zoom) mainWindow.webContents.setZoomLevel(zoom - 0.5);
                }},
                { label: 'Сброс масштаба', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.setZoomLevel(0) },
                { type: 'separator' },
                { label: 'Консоль разработчика', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() }
            ]
        },
        {
            label: 'Справка',
            submenu: [
                { label: 'О программе', click: showAboutDialog }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Сохраняем настройки и сессию в файл
async function exportProfile() {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Сохранить профиль',
            defaultPath: 'lampa-profile.json',
                filters: [{ name: 'JSON файлы', extensions: ['json'] }]
        });

        if (canceled || !filePath) return;

        // Получаем localStorage
        const localStorageData = await mainWindow.webContents.executeJavaScript(`
        Object.assign({}, localStorage)
        `);

        // Собираем данные профиля
        const profile = {
            settings: store.get(),
            localStorage: localStorageData
        };

        // Сохраняем в файл
        await fs.writeFile(filePath, JSON.stringify(profile, null, 2));
        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Готово',
            message: 'Профиль сохранен!',
            detail: `Файл: ${filePath}`,
            buttons: ['OK']
        });
    } catch (err) {
        await dialog.showErrorBox('Ошибка', `Не удалось сохранить профиль: ${err.message}`);
    }
}

// Загружаем настройки и сессию из файла
async function importProfile() {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Загрузить профиль',
            filters: [{ name: 'JSON файлы', extensions: ['json'] }],
            properties: ['openFile']
        });

        if (canceled || !filePaths.length) return;

        const data = await fs.readFile(filePaths[0], 'utf-8');
        const profile = JSON.parse(data);

        if (typeof profile !== 'object' || profile === null) {
            throw new Error('Неверный формат файла');
        }

        // Восстанавливаем настройки
        if (profile.settings) {
            store.set(profile.settings);
        }

        // Восстанавливаем localStorage
        if (profile.localStorage) {
            await mainWindow.webContents.executeJavaScript(`
            Object.entries(${JSON.stringify(profile.localStorage)}).forEach(([key, value]) => {
                localStorage.setItem(key, value);
            });
            `);
        }

        // Загружаем URL и обновляем размеры окна
        const newUrl = store.get('startUrl', APP_CONFIG.defaultUrl);
        await mainWindow.loadURL(newUrl);

        const bounds = store.get('windowBounds', {
            width: APP_CONFIG.defaultWidth,
            height: APP_CONFIG.defaultHeight
        });
        mainWindow.setBounds(bounds);

        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Готово',
            message: 'Профиль загружен!',
            buttons: ['OK']
        });
    } catch (err) {
        await dialog.showErrorBox('Ошибка', `Не удалось загрузить профиль: ${err.message}`);
    }
}

// Окно "О программе"
function showAboutDialog() {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'О программе',
        message: 'Lampa Linux Client',
        detail: `Версия: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode.js: ${process.versions.node}\nChromium: ${process.versions.chrome}\n\nКлиент для Lampa.mx`,
        buttons: ['OK']
    });
}

// IPC обработчики
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-platform', () => process.platform);

ipcMain.on('fs-readFile', (event, filePath, options) => {
    fs.readFile(filePath, options)
    .then(data => event.sender.send(`fs-readFile-response-${filePath}`, null, data))
    .catch(err => event.sender.send(`fs-readFile-response-${filePath}`, err));
});

ipcMain.on('fs-writeFile', (event, filePath, data, options) => {
    fs.writeFile(filePath, data, options)
    .then(() => event.sender.send(`fs-writeFile-response-${filePath}`, null))
    .catch(err => event.sender.send(`fs-writeFile-response-${filePath}`, err));
});

ipcMain.on('fs-existsSync', (event, filePath) => {
    event.returnValue = existsSync(filePath);
});

ipcMain.on('child-process-spawn', (event, id, cmd, args, opts) => {
    const child = spawn(cmd, args, opts);
    child.on('error', (err) => event.sender.send(`child-process-spawn-error-${id}`, err));
    child.on('exit', (code) => event.sender.send(`child-process-spawn-exit-${id}`, code));
    child.stdout.on('data', (data) => event.sender.send(`child-process-spawn-stdout-${id}`, data));
    child.stderr.on('data', (data) => event.sender.send(`child-process-spawn-stderr-${id}`, data));
});

// Запуск приложения
app.whenReady().then(() => {
    createWindow();
    createMenu();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Только один экземпляр приложения
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}
