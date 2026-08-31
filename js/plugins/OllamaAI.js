/**
 * @plugindesc RPGMaker MV 调用Ollama AI插件（新增：前后台任务队列 + 前台插队 + 后台不阻塞）
 * @author 增强版（队列+前后台）
 * @help 
 * 插件命令使用说明：
 * ================= 前台任务（玩家触发，插队执行，游戏等待） =================
 * 1. 基础前台调用：CallOllama 模型名 提示词
 *    示例：CallOllama llama3 "你好，介绍一下自己"
 * 2. 基于文件前台调用：CallOllamaWithFile 模型名 文件名 提示词
 *    示例：CallOllamaWithFile llama3 story.txt "基于这个故事续写一段剧情"
 * 
 * ================= 后台任务（提前缓存，追加队列，不阻塞游戏） =================
 * 3. 基础后台调用：AddOllamaBackground 模型名 提示词
 *    示例：AddOllamaBackground llama3 "预生成一段游戏背景故事"
 * 4. 基于文件后台调用：AddOllamaBackgroundWithFile 模型名 文件名 提示词
 *    示例：AddOllamaBackgroundWithFile llama3 npc.json "预生成NPC对话库"
 * 
 * 文件路径说明：
 * 需将文件放在项目根目录的 data/ai_files/ 下，支持 .txt（文本）和 .json（JSON转字符串）格式
 * 
 * 核心逻辑：
 * - 所有任务存入同一队列，前台任务插队到「当前任务后一位」，后台任务追加到队尾
 * - 后台任务执行时不锁定游戏操作、不拦截输入；前台任务执行时锁定操作+游戏等待
 * - 队列自动依次执行，当前任务完成后立即执行下一个
 */

// ===================== 全局变量与原始方法缓存 =====================
// 缓存原始插件命令方法
const _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
// 缓存原始地图场景更新方法
const _Scene_Map_updateMain = Scene_Map.prototype.updateMain;

// 全局状态：任务队列（存储所有前后台任务）
let ollamaTaskQueue = [];
// 全局状态：是否正在执行任务（区分类型：null/foreground/background）
let currentTaskType = null;
// 全局状态：是否正在处理前台任务（用于锁定操作）
let isForegroundProcessing = false;

// ===================== 任务结构与队列管理 =====================
/**
 * 任务入队逻辑
 * @param {Object} task 任务对象 { type: 'foreground/background', model, prompt [, fileName] }
 */
function enqueueOllamaTask(task) {
    if (currentTaskType === null) {
        // 无正在执行的任务：直接入队并立即执行
        ollamaTaskQueue.push(task);
        executeNextOllamaTask();
    } else {
        if (task.type === 'foreground') {
            // 前台任务：插队到当前任务后一位
            ollamaTaskQueue.splice(1, 0, task);
        } else {
            // 后台任务：追加到队尾
            ollamaTaskQueue.push(task);
        }
    }
}

/**
 * 执行队列下一个任务
 */
function executeNextOllamaTask() {
    if (ollamaTaskQueue.length === 0) {
        // 队列为空：重置状态
        currentTaskType = null;
        isForegroundProcessing = false;
        return;
    }

    // 取出队列第一个任务执行
    const nextTask = ollamaTaskQueue.shift();
    currentTaskType = nextTask.type;

    if (nextTask.type === 'foreground') {
        // 执行前台任务（沿用原有锁定逻辑）
        executeForegroundTask(nextTask);
    } else {
        // 执行后台任务（不锁定操作）
        executeBackgroundTask(nextTask);
    }
}

// ===================== 前后台任务执行逻辑 =====================
/**
 * 执行前台任务（锁定操作 + 游戏等待 + 调用AI）
 * @param {Object} task 前台任务对象
 */
function executeForegroundTask(task) {
    // 1. 锁定玩家操作
    isForegroundProcessing = true;
    $gamePlayer.setMoveRoute({ through: false }); // 禁止穿图
    $gamePlayer.canMove = () => false;            // 禁用移动
    $gameTemp._canCallMenu = false;               // 禁用菜单
    if ($gameMap._interpreter) {
        $gameMap._interpreter.setWaitMode('ollama'); // 事件等待
    }

    // 2. 构造AI请求参数
    const reqParams = { model: task.model, prompt: task.prompt, stream: false };

    // 3. 调用Ollama API
    fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqParams)
    })
    .then(res => res.json())
    .then(data => {
        const reply = data.response || "AI没有返回有效内容";
        const formattedReply = wrapText(reply);
        $gameMessage.clear();
        $gameMessage.add("AI（前台）：\n" + formattedReply);
    })
    .catch(err => {
        $gameMessage.clear();
        $gameMessage.add(`前台AI请求错误：${err.message}`);
    })
    .finally(() => {
        // 4. 恢复操作 + 执行下一个任务
        isForegroundProcessing = false;
        $gamePlayer.canMove = () => true;
        $gameTemp._canCallMenu = true;
        if ($gameMap._interpreter) {
            $gameMap._interpreter.setWaitMode('');
        }
        setTimeout(executeNextOllamaTask, 0); // 异步执行下一个任务
    });
}

/**
 * 执行后台任务（不锁定操作 + 静默执行 + 缓存结果）
 * @param {Object} task 后台任务对象
 */
function executeBackgroundTask(task) {
    // 1. 构造AI请求参数（无任何锁定操作）
    const reqParams = { model: task.model, prompt: task.prompt, stream: false };

    // 2. 调用Ollama API（静默执行，仅缓存结果，不显示到对话框）
    fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqParams)
    })
    .then(res => res.json())
    .then(data => {
        // 后台任务结果缓存（可根据需求扩展：存入全局变量/本地存储）
        const backgroundResult = data.response || "AI无返回内容";
        console.log(`【后台AI任务完成】模型：${task.model}，结果：${backgroundResult.substring(0, 50)}...`);
        // 如需前台展示后台结果，可自行添加逻辑：
        // $gameMessage.add("AI（后台缓存）：\n" + wrapText(backgroundResult));
    })
    .catch(err => {
        console.error(`后台AI请求错误：${err.message}`);
    })
    .finally(() => {
        // 3. 执行下一个任务
        setTimeout(executeNextOllamaTask, 0);
    });
}

// ===================== 工具函数=====================
function wrapText(text, maxLength = 24) {
    let result = '';
    let count = 0;
    for (let char of text) {
        result += char;
        count += /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.5;
        if(char == '\n') count = 0;
        if (count >= maxLength) {
            result += '\n';
            count = 0;
        }
    }
    return result;
}

// ===================== 文件读取=====================
Game_Interpreter.prototype.loadLocalFile = function(fileName) {
    const filePath = `data/ai_files/${fileName}`;
    return new Promise((resolve, reject) => {
        fetch(filePath)
            .then(response => {
                if (!response.ok) reject(new Error(`文件不存在或读取失败：${filePath}`));
                if (filePath.endsWith('.json')) {
                    return response.json().then(data => JSON.stringify(data));
                } else {
                    return response.text();
                }
            })
            .then(content => resolve(content))
            .catch(err => reject(err));
    });
};

// ===================== 插件命令注册（新增前后台区分） =====================
Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _Game_Interpreter_pluginCommand.call(this, command, args);

    // -------------------- 前台任务命令（玩家触发） --------------------
    // 基础前台调用
    if (command === 'CallOllama') {
        const model = args[0];
        const prompt = args.slice(1).join(' ');
        enqueueOllamaTask({ type: 'foreground', model, prompt });
    }
    // 基于文件前台调用
    if (command === 'CallOllamaWithFile') {
        const model = args[0];
        const fileName = args[1];
        const prompt = args.slice(2).join(' ');
        this.loadLocalFile(fileName).then(fileContent => {
            const fullPrompt = `参考文件内容：\n${fileContent}\n\n要求：${prompt}`;
            enqueueOllamaTask({ type: 'foreground', model, prompt: fullPrompt });
        }).catch(err => {
            $gameMessage.add(`文件读取错误：${err.message}`);
        });
    }

    // -------------------- 后台任务命令（提前缓存） --------------------
    // 基础后台调用
    if (command === 'AddOllamaBackground') {
        const model = args[0];
        const prompt = args.slice(1).join(' ');
        enqueueOllamaTask({ type: 'background', model, prompt });
    }
    // 基于文件后台调用
    if (command === 'AddOllamaBackgroundWithFile') {
        const model = args[0];
        const fileName = args[1];
        const prompt = args.slice(2).join(' ');
        this.loadLocalFile(fileName).then(fileContent => {
            const fullPrompt = `参考文件内容：\n${fileContent}\n\n要求：${prompt}`;
            enqueueOllamaTask({ type: 'background', model, prompt: fullPrompt });
        }).catch(err => {
            console.error(`后台文件读取错误：${err.message}`);
        });
    }
};

// ===================== 场景输入拦截（仅拦截前台任务） =====================
Scene_Map.prototype.updateMain = function() {
    // 仅当执行前台任务时，拦截输入；后台任务/无任务时正常执行
    if (!isForegroundProcessing) {
        _Scene_Map_updateMain.call(this);
    }
};