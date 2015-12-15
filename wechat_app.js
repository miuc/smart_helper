var wechat = require('wechat');
var express = require('express');
var log4js = require('log4js');
var mysql = require('mysql');
var util = require('util');
var async = require('async');
var phpjs = require('phpjs');
var gconfig = require('./config.js');

console.log(gconfig);
var config = {
    token: gconfig.wechat_config.token,
    appid: gconfig.wechat_config.appid,
    encodingAESKey: gconfig.wechat_config.encodingAESKey
};

var connection = mysql.createConnection({
    host : gconfig.db_config.host,
    user : gconfig.db_config.user,
    password : gconfig.db_config.password,
    database : gconfig.db_config.database,
});

connection.connect();

var type = (function(global) {
    var cache = {};
    return function(obj) {
        var key;
        return obj === null ? 'null' // null
            : obj === global ? 'global' // window in browser or global in nodejs
            : (key = typeof obj) !== 'object' ? key // basic: string, boolean, number, undefined, function
            : obj.nodeType ? 'object' // DOM element
            : cache[key = ({}).toString.call(obj)] // cached. date, regexp, error, object, array, math
            || (cache[key] = key.slice(8, -1).toLowerCase()); // get XXXX from [object XXXX], and cache it
    };
}(this));

log4js.configure({
        appenders: [
            {type: 'console'},
            {type: 'file', filename: gconfig.log.file, category: 'dev'}
            ]
});

var logger = log4js.getLogger('dev');
logger.setLevel('DEBUG');

var main_txt = "么么哒！";
var error_txt = '系统出问题啦 T__T , 联系管理员修复吧!';
var features = [
    {id: '0', tips: '回复“金额”, 记录今天的开销，可累加！'},
    {id: '3', tips: '回复“=金额”, 重置今天的开销！'},
    {id: '2', tips: '回复“日期 金额”, 记录当天开销。'},
    {id: '1', tips: '回复“历史”, 查看最近开销。'}
    ];

var app = express();

function query_history(message, callback) {
    connection.query('select day, amount from daily_expend_tab where user ="' + message.FromUserName + '" order by day desc;',
    function(err, rows, fields){
        var result = '';
            if (err) {
                logger.error(util.format('query user daily spend error: user[%s] content[%s]', message.FromUserName, message.Content));
                logger.error(err);
                result = '查账失败 T__T , 联系管理员修复吧!';
                
            }
            result += "最近五天的开销记录：\n\n";
            for (var i=0, len = rows.length; i < len && i <= 4; ++i)
            {
                logger.info(rows[i]);
                var myDate = rows[i].day;
                myDate.setDate(myDate.getDate() + 1);
                result += util.format("%s，\t开销：%d\t元\n", 
                                      myDate.toISOString().replace(/T/, ' ').split(' ')[0].replace(/-/g, '.'), 
                                    rows[i].amount*1.0 / 10000);
            }
            
            if (result.length = 0)
                result = "还没有任何历史记录哦!";
            
            callback(null, result);
        });
}

app.use(express.query());
app.use(log4js.connectLogger(logger, {level: log4js.levels.DEBUG}));
app.use('/wechat', wechat(config, function (req, res, next) {
    // 微信输入信息都在req.weixin上
    var message = req.weixin;
    var result = '';

    if (message.Content.indexOf(' ') > 0) {
        //设置历史
        var splitMessage = message.Content.split(' ');
        var day = splitMessage[0], amount = splitMessage[1];
        var dayParts = day.split('.');
        if (dayParts.length == 2)
        {
            var today = new Date();
            var dayObj = [today.getUTCFullYear(), dayParts[0], dayParts[1]];
        } else if (dayParts.length == 3 ) {
            var dayObj = [dayParts[0], dayParts[1], dayParts[2]];
        } else {
            return res.reply('输入日期格式不正确哦，输入例如"7.3"或"2015.7.3"来选择日期亲~');
        }
        //return res.reply('开发中!!');
        async.series([
            function ( callback ) {
                logger.info(dayObj);
                var queryStr = 'insert into daily_expend_tab (`user`, `day`, `amount`) values ("' + message.FromUserName + '", "' + dayObj[0] + '-' + dayObj[1] + '-' + dayObj[2] + ' 00:00:00", ' + Math.floor(amount * 10000) + ') on duplicate key update amount=values(amount);';
                logger.info(queryStr);
                connection.query(queryStr,
                    function(err, rows, fields){
                        if (err) {
                                logger.error(util.format('save user daily spend error: user[%s] content[%s]', message.FromUserName, message.Content));
                                logger.error(err);
                                result = '记账失败 T__T , 联系管理员修复吧!';
                            }
                            result = '记账成功啦, 回复"历史"查看吧!';
                            callback();
                        });
            }
        ], function (error, results){
            if (result.length > 0)
                return res.reply(result);
            else
                return res.reply(error_txt);
        });
    }
    else if (
            (message.Content[0]=='=')
            &&
            (!isNaN(parseFloat(message.Content.substring(1, message.Content.length))))
            ){
        // 设置值模式
        var amount = parseFloat(message.Content.substring(1, message.Content.length));
        async.series([
            function ( callback ) {
                var queryStr = 'insert into daily_expend_tab (`user`, `day`, `amount`) values ("' + message.FromUserName + '", now(), ' + Math.floor(amount * 10000) + ') on duplicate key update amount=values(amount);';
                logger.info(queryStr);
                connection.query(queryStr,
                    function(err, rows, fields){
                        if (err) {
                                logger.error(util.format('save user daily spend error: user[%s] content[%s]', message.FromUserName, message.Content));
                                logger.error(err);
                                result = '记账失败 T__T , 联系管理员修复吧!';
                            }
                            result = '记账成功啦, 回复"历史"查看吧!';
                            callback();
                        });
            }
        ], function (error, results){
            if (result.length > 0)
                return res.reply(result);
            else
                return res.reply(error_txt);
        });
    }
    else if (!isNaN(parseFloat(message.Content))) {
        var amount = message.Content;
        // 累加值模式
        if (phpjs.strpbrk(amount, '+-*/')){
            amount = eval(amount);
        }
        amount = parseFloat(amount);
        async.series([
            function ( callback ) {
                var queryStr = 'insert into daily_expend_tab (`user`, `day`, `amount`) values ("' + message.FromUserName + '", now(), ' + Math.floor(amount * 10000) + ') on duplicate key update amount=amount+values(amount);';
                logger.info(queryStr);
                connection.query(queryStr,
                    function(err, rows, fields){
                        if (err) {
                                logger.error(util.format('save user daily spend error: user[%s] content[%s]', message.FromUserName, message.Content));
                                logger.error(err);
                                result = '记账失败 T__T , 联系管理员修复吧!';
                            }
                            result = '记账成功啦, 回复"历史"查看吧!';
                            callback();
                        });
            }
        ], function (error, results){
            if (result.length > 0)
                return res.reply(result);
            else
                return res.reply(error_txt);
        });
    }
    else if (message.Content === "历史") {
        //查询历史
        async.waterfall([
            function(callback){
                query_history(message, callback);
            }],
            function (error, result){
                logger.info(result);
            if (result.length > 0)
                return res.reply(result);
            else
                return res.reply(error_txt)
            }
        );
    }
    else {
        // 返回菜单
        res.reply(function (){ 
            var ret = main_txt + '\n\n';
            for (var x in features){
                ret += features[x].tips + '\n';
            }
            return ret;
        }());
    }
}));

process.on('uncaughtException', function (error) {
       logger.error(error.stack);
});

var server = app.listen(3000, '127.0.0.1', function(){

    var host = server.address().address;
    var port = server.address().port;

    console.log('wechat app listening at http://%s:%s', host, port);
});
