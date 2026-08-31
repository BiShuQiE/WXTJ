/**
 * @plugindesc RPGMaker MV 调用Ollama AI插件（核心特性：AI请求中锁定操作 + 防对话被顶）
 * @author 最终版
 * @help 
 * 插件命令使用说明：
 * 1. 基础调用：CallOllama 模型名 提示词
 *    示例：CallOllama llama3 "你好，介绍一下自己"
 * 2. 基于文件调用：CallOllamaWithFile 模型名 文件名 提示词
 *    示例：CallOllamaWithFile llama3 story.txt "基于这个故事续写一段剧情"
 * 
 * 文件路径说明：
 * 需将文件放在项目根目录的 data/ai_files/ 下，支持 .txt（文本）和 .json（JSON转字符串）格式
 */

// ===================== 全局变量与原始方法缓存 =====================
// 缓存原始插件命令方法（用于后续调用原生逻辑）
const _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
// 缓存原始地图场景更新方法（用于拦截输入）
const _Scene_Map_updateMain = Scene_Map.prototype.updateMain;

// 全局状态标记：是否正在处理Ollama AI请求（用于锁定操作）
let isOllamaProcessing = false;

// ===================== 插件命令注册 =====================
/**
 * 重写插件命令处理逻辑
 * @param {string} command 插件命令名称
 * @param {string[]} args 插件命令参数列表
 */
Game_Interpreter.prototype.pluginCommand = function(command, args) {
    // 执行原生插件命令逻辑
    _Game_Interpreter_pluginCommand.call(this, command, args);

    // 处理基础AI调用命令
    if (command === 'CallOllama') {
        const model = args[0];          // AI模型名称（如llama3、gemma）
        const prompt = args.slice(1).join(' '); // AI提示词（拼接参数数组）
        this.callOllamaFunction(model, prompt);
    }
    
    // 处理基于文件的AI调用命令
    if (command === 'CallOllamaWithFile') {
        const model = args[0];          // AI模型名称
        const fileName = args[1];       // 本地文件名称（位于data/ai_files/下）
        const prompt = args.slice(2).join(' '); // AI提示词
        this.loadFileAndCallOllamaFunction(model, fileName, prompt);
    }
};

// ===================== 工具函数 =====================
/**
 * 文本自动换行处理（适配RPGMaker MV对话框显示）
 * @param {string} text 待处理的文本内容
 * @param {number} maxLength 每行最大字符数（中文字符计1，英文字符计0.5）
 * @returns {string} 换行后的格式化文本
 */
function wrapText(text, maxLength = 24) {
    let result = '';
    let count = 0;
    for (let char of text) {
        result += char;
        // 字符长度计算：中文字符算1个单位，非中文字符算0.5个单位
        count += /[\u4e00-\u9fa5]/.test(char) ? 1 : 0.5;
        // 换行后重新计算
        if(char == '\n') count = 0;
        // 达到最大长度则换行
        if (count >= maxLength) {
            result += '\n';
            count = 0;
        }
    }
    return result;
}

// ===================== 文件操作 =====================
/**
 * 读取本地文件内容（RPGMaker MV项目内）
 * @param {string} fileName 文件名（含后缀，如story.txt、config.json）
 * @returns {Promise<string>} 文件内容Promise（TXT返回文本，JSON返回序列化字符串）
 */
Game_Interpreter.prototype.loadLocalFile = function(fileName) {
    // 拼接完整文件路径：项目根目录/data/ai_files/ + 文件名
    const filePath = `data/ai_files/${fileName}`;

    return new Promise((resolve, reject) => {
        fetch(filePath)
            .then(response => {
                // 校验文件请求状态
                if (!response.ok) reject(new Error(`文件不存在或读取失败：${filePath}`));
                // 根据文件后缀处理内容
                if (filePath.endsWith('.json')) {
                    return response.json().then(data => JSON.stringify(data));
                } else {
                    return response.text(); // 默认为TXT文本处理
                }
            })
            .then(content => resolve(content))
            .catch(err => reject(err));
    });
};

// ===================== 核心AI调用逻辑 =====================
/**
 * 基础AI调用方法（锁定操作 + 调用Ollama API + 解锁操作）
 * @param {string} model AI模型名称（如llama3）
 * @param {string} prompt 发送给AI的提示词
 */
Game_Interpreter.prototype.callOllamaFunction = function(model, prompt) {
    // 1. 锁定玩家操作：禁止移动、穿图、打开菜单
    isOllamaProcessing = true;
    $gamePlayer.setMoveRoute({ through: false }); // 禁止穿图
    $gamePlayer.canMove = () => false;            // 禁用玩家移动
    $gameTemp._canCallMenu = false;               // 禁用菜单调用
    this.setWaitMode('ollama');                   // 设置事件等待模式

    // 2. 构造Ollama API请求参数
    const reqParams = {
        model: model,
        prompt: prompt,
        stream: false // 关闭流式响应，等待完整回复
    };

    // 3. 调用Ollama本地API
    fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqParams)
    })
    .then(res => res.json())
    .then(data => {
        // 处理AI回复：格式化后显示到游戏对话框
        const reply = data.response || "AI没有返回有效内容";
        const formattedReply = wrapText(reply);
        $gameMessage.clear();
        $gameMessage.add("AI：\n" + formattedReply);
    })
    .catch(err => {
        // 处理请求错误
        $gameMessage.clear();
        $gameMessage.add(`AI请求错误：${err.message}`);
    })
    .finally(() => {
        // 4. 回复完成：恢复所有玩家操作
        isOllamaProcessing = false;
        $gamePlayer.canMove = () => true;     // 恢复玩家移动
        $gameTemp._canCallMenu = true;        // 恢复菜单调用
        this.setWaitMode('');                 // 解除事件等待模式
    });
};

/**
 * 基于本地文件的AI调用方法（先读文件 + 拼接提示词 + 调用AI）
 * @param {string} model AI模型名称
 * @param {string} fileName 本地文件名（位于data/ai_files/下）
 * @param {string} prompt 用户自定义提示词
 */
Game_Interpreter.prototype.loadFileAndCallOllamaFunction = function(model, fileName, prompt) {
    // 1. 锁定玩家操作：禁止移动、穿图、打开菜单
    isOllamaProcessing = true;
    $gamePlayer.setMoveRoute({ through: false }); // 禁止穿图
    $gamePlayer.canMove = () => false; // 禁用玩家移动
    $gameTemp._canCallMenu = false; // 禁用菜单

    this.setWaitMode('ollama');

    // 2. 先读取本地文件，再调用AI
    this.loadLocalFile(fileName)
    .then(fileContent => {
        // 拼接完整提示词：文件内容 + 用户提示词
        const fullPrompt = `以下是参考文件内容：\n${fileContent}\n\n请基于以上内容，完成我的要求：${prompt}`;
        // 调用Ollama API
        return fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: fullPrompt,
                stream: false
            })
        });
    })
    .then(res => res.json())
    .then(data => {
        // 处理AI回复并显示
        const reply = data.response || "AI没有返回有效内容";
        const formattedReply = wrapText(reply);
        $gameMessage.clear();
        $gameMessage.add("AI：\n" + formattedReply);
    })
    .catch(err => {
        // 处理文件读取或API请求错误
        $gameMessage.clear();
        $gameMessage.add(`操作错误：${err.message}`);
    })
    .finally(() => {
        // 回复完成：恢复所有玩家操作
        isOllamaProcessing = false;
        $gamePlayer.canMove = () => true; // 恢复移动
        $gameTemp._canCallMenu = true; // 恢复菜单
        this.setWaitMode(''); // 解除事件等待
    });
};

// ===================== 场景输入拦截 =====================
/**
 * 重写地图场景主更新方法（拦截AI请求中的玩家输入）
 * 作用：AI处理请求时，禁止触发任何玩家输入相关的逻辑
 */
Scene_Map.prototype.updateMain = function() {
    // 仅当AI未处理请求时，执行原生地图更新逻辑
    if (!isOllamaProcessing) {
        _Scene_Map_updateMain.call(this);
    }
};