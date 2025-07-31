const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require('electron');
const path = require('path');
const Store = require('electron-store').default;
const prompt = require('electron-prompt');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const { spawn } = require('child_process');
const https = require('https');

const store = new Store(); // Хранилище настроек

let mainWindow; // Главное окно приложения

const APP_CONFIG = {
    defaultUrl: 'http://lampa.mx',
        minWidth: 1024,
        minHeight: 768,
        defaultWidth: 1366,
            defaultHeight: 768,
                githubRepo: 'Boria138/Lampa',
                updateCheckInterval: 24 * 60 * 60 * 1000,
};

// Функция инициализации стандартного localStorage для Lampa
async function initializeLampaStorage() {
    try {
        await mainWindow.webContents.executeJavaScript(`
        // Инициализируем стандартные настройки Lampa, если они не установлены
        if (!localStorage.getItem("keyboard_type")) {
            localStorage.setItem("keyboard_type", "integrate");
        }
        if (!localStorage.getItem("device_name")) {
            localStorage.setItem("device_name", "Lampa Linux");
        }

        console.log("Lampa localStorage initialized:");
        console.log("keyboard_type:", localStorage.getItem("keyboard_type"));
        console.log("device_name:", localStorage.getItem("device_name"));
        `);

        console.log('Стандартные настройки Lampa инициализированы');
    } catch (error) {
        console.error('Ошибка при инициализации localStorage:', error);
    }
}

// Функция для HTTP запросов
function httpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            headers: {
                'User-Agent': `Lampa-Linux-Client/${app.getVersion()}`,
                                  ...options.headers
            },
            ...options
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

// Проверка обновлений
async function checkForUpdates(showNoUpdatesDialog = false) {
    try {
        const currentVersion = app.getVersion();
        console.log(`Проверка обновлений... Текущая версия: ${currentVersion}`);

        // Получаем последний релиз из GitHub API
        const apiUrl = `https://api.github.com/repos/${APP_CONFIG.githubRepo}/releases/latest`;
        const release = await httpsRequest(apiUrl);

        if (!release || !release.tag_name) {
            throw new Error('Не удалось получить информацию о релизе');
        }

        const latestVersion = release.tag_name.replace(/^v/, ''); // Убираем префикс 'v'
        console.log(`Последняя версия на GitHub: ${latestVersion}`);

        // Сравниваем версии
        if (compareVersions(currentVersion, latestVersion) < 0) {
            console.log('Доступно обновление!');

            // Показываем диалог об обновлении
            const response = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Доступно обновление',
                message: `Доступна новая версия ${latestVersion}`,
                detail: `Текущая версия: ${currentVersion}\nНовая версия: ${latestVersion}\n\n${release.body || 'Описание изменений отсутствует'}`,
                buttons: ['Скачать', 'Позже', 'Больше не показывать'],
                defaultId: 0,
                    cancelId: 1
            });

            switch (response.response) {
                case 0: // Скачать
                    shell.openExternal(release.html_url);
                    break;
                case 2: // Больше не показывать
                    store.set('skipUpdates', true);
                    break;
            }
        } else {
            console.log('Обновлений нет');
            if (showNoUpdatesDialog) {
                await dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: 'Обновления',
                    message: 'У вас установлена последняя версия',
                    detail: `Текущая версия: ${currentVersion}`,
                    buttons: ['OK']
                });
            }
        }

        // Сохраняем время последней проверки
        store.set('lastUpdateCheck', Date.now());

    } catch (error) {
        console.error('Ошибка при проверке обновлений:', error);
        if (showNoUpdatesDialog) {
            await dialog.showErrorBox('Ошибка', `Не удалось проверить обновления: ${error.message}`);
        }
    }
}

// Сравнение версий (возвращает -1, 0, или 1)
function compareVersions(version1, version2) {
    const v1parts = version1.split('.').map(n => parseInt(n) || 0);
    const v2parts = version2.split('.').map(n => parseInt(n) || 0);

    const maxLength = Math.max(v1parts.length, v2parts.length);

    for (let i = 0; i < maxLength; i++) {
        const v1part = v1parts[i] || 0;
        const v2part = v2parts[i] || 0;

        if (v1part < v2part) return -1;
        if (v1part > v2part) return 1;
    }

    return 0;
}

// Автоматическая проверка обновлений
function scheduleUpdateCheck() {
    const skipUpdates = store.get('skipUpdates', false);
    if (skipUpdates) {
        console.log('Автоматическая проверка обновлений отключена');
        return;
    }

    const lastCheck = store.get('lastUpdateCheck', 0);
    const timeSinceLastCheck = Date.now() - lastCheck;

    if (timeSinceLastCheck >= APP_CONFIG.updateCheckInterval) {
        // Проверяем сразу при запуске, если прошло достаточно времени
        setTimeout(() => checkForUpdates(false), 3000); // Задержка 3 секунды после запуска
    }

    // Планируем следующую проверку
    const timeUntilNextCheck = APP_CONFIG.updateCheckInterval - (timeSinceLastCheck % APP_CONFIG.updateCheckInterval);
    setTimeout(() => {
        checkForUpdates(false);
        // Повторяем каждые 24 часа
        setInterval(() => checkForUpdates(false), APP_CONFIG.updateCheckInterval);
    }, timeUntilNextCheck);
}

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

        // Обновляем состояние меню при запуске
        updateMenuState();

        // Запускаем планировщик проверки обновлений
        scheduleUpdateCheck();
    });

    // Инициализируем localStorage после полной загрузки страницы
    mainWindow.webContents.once('dom-ready', () => {
        // Добавляем небольшую задержку, чтобы убедиться, что страница полностью загружена
        setTimeout(() => {
            initializeLampaStorage();
        }, 1000);
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

// Обновляем состояние меню
function updateMenuState() {
    const menu = Menu.getApplicationMenu();
    if (menu) {
        const fileMenu = menu.items.find(item => item.label === 'Файл');
        if (fileMenu) {
            const updateSettingsMenu = fileMenu.submenu.items.find(item => item.label === 'Настройки обновлений');
            if (updateSettingsMenu) {
                const autoCheckMenuItem = updateSettingsMenu.submenu.items.find(item => item.label === 'Включить автопроверку');
                if (autoCheckMenuItem) {
                    autoCheckMenuItem.checked = !store.get('skipUpdates', false);
                }
            }
        }
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
                {
                    label: 'Проверить обновления',
                    click: () => checkForUpdates(true)
                },
                {
                    label: 'Настройки обновлений',
                    submenu: [
                        {
                            label: 'Включить автопроверку',
                            type: 'checkbox',
                            checked: !store.get('skipUpdates', false),
                            click: (menuItem) => {
                                store.set('skipUpdates', !menuItem.checked);
                                if (menuItem.checked) {
                                    scheduleUpdateCheck();
                                }
                            }
                        }
                    ]
                },
                { type: 'separator' },
                { label: 'Сбросить настройки', click: async () => {
                    const response = await dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        title: 'Подтверждение',
                        message: 'Вы уверены, что хотите сбросить все настройки?',
                        detail: 'Это действие нельзя отменить. Все настройки приложения и локальное хранилище будут очищены.',
                        buttons: ['Да, сбросить', 'Отмена'],
                        defaultId: 1,
                            cancelId: 1
                    });

                    if (response.response === 0) {
                        store.clear();
                        await mainWindow.webContents.executeJavaScript('localStorage.clear();');
                        // Переинициализируем стандартные настройки Lampa после сброса
                        setTimeout(() => {
                            initializeLampaStorage();
                        }, 500);
                        // Обновляем меню после сброса настроек
                        updateMenuState();
                        await dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'Сброс',
                            message: 'Настройки и локальное хранилище сброшены',
                            buttons: ['OK']
                        });
                        mainWindow.loadURL(APP_CONFIG.defaultUrl);
                    }
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
                    if (zoom !== undefined) mainWindow.webContents.setZoomLevel(zoom + 0.5);
                }},
                { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', click: () => {
                    const zoom = mainWindow?.webContents.getZoomLevel();
                    if (zoom !== undefined) mainWindow.webContents.setZoomLevel(zoom - 0.5);
                }},
                { label: 'Сброс масштаба', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.setZoomLevel(0) },
                { type: 'separator' },
                { label: 'Консоль разработчика', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() }
            ]
        },
        {
            label: 'Справка',
            submenu: [
                {
                    label: 'Открыть GitHub',
                    click: () => shell.openExternal(`https://github.com/${APP_CONFIG.githubRepo}`)
                },
                { type: 'separator' },
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
            localStorage: localStorageData,
            exportDate: new Date().toISOString(),
            appVersion: app.getVersion()
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

        // Убеждаемся, что стандартные настройки Lampa установлены
        await initializeLampaStorage();

        // Загружаем URL и обновляем размеры окна
        const newUrl = store.get('startUrl', APP_CONFIG.defaultUrl);
        await mainWindow.loadURL(newUrl);

        const bounds = store.get('windowBounds', {
            width: APP_CONFIG.defaultWidth,
            height: APP_CONFIG.defaultHeight
        });
        mainWindow.setBounds(bounds);

        // Обновляем состояние меню после импорта профиля
        updateMenuState();

        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Готово',
            message: 'Профиль загружен!',
            detail: profile.exportDate ? `Дата экспорта: ${new Date(profile.exportDate).toLocaleString()}` : '',
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
        detail: `Версия: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode.js: ${process.versions.node}\nChromium: ${process.versions.chrome}\n\nКлиент для Lampa.mx\nGitHub: ${APP_CONFIG.githubRepo}`,
                          buttons: ['OK'],
                          defaultId: 0
    });
}

// IPC обработчики
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('check-for-updates', () => checkForUpdates(true));

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
