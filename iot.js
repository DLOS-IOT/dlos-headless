/*jslint node: true */

/*
	Accept commands via JSON-RPC API.
	The daemon listens on port 6332 by default.
	See https://github.com/DLOS-IOT/dlos-headless/wiki/Running-RPC-service for detailed description of the API
*/

"use strict";
var headlessWallet = require('./start.js');
var conf = require('dloscore/conf.js');
var eventBus = require('dloscore/event_bus.js');
var db = require('dloscore/db.js');
var mutex = require('dloscore/mutex.js');
var storage = require('dloscore/storage.js');
var constants = require('dloscore/constants.js');
var validationUtils = require("dloscore/validation_utils.js");
var device = require('dloscore/device.js');
const Gpio = require('rpio2/lib/index.js').Gpio;
var sensorLib = require('node-dht-sensor');
var sensorType = 11; // 11 for DHT11, 22 for DHT22 and AM2302
var sensorPin  = 16;  // The GPIO pin number for sensor signal
var led = new Gpio(12);  //创建 P36 引脚
var wallet_id;
var temptext=null;
if (conf.bSingleAddress)
	throw Error('can`t run in single address mode');

	function getIPAdress(){  
		var interfaces = require('os').networkInterfaces();  
		for(var devName in interfaces){  
			  var iface = interfaces[devName];  
			  for(var i=0;i<iface.length;i++){  
				   var alias = iface[i];  
				   if(alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal){  
						 return alias.address;  
				   }  
			  }  
		}  
	} 
	function dht11(){  

		if (!sensorLib.initialize(sensorType, sensorPin)) {
			console.warn('Failed to initialize sensor');
			//process.exit(1);
		}else
		{
		var readout = sensorLib.read();
		return 'Temperature:'+ readout.temperature.toFixed(1) + 'C'+'\n Humidity:   '+ readout.humidity.toFixed(1)    + '%'
		console.log('Temperature:', readout.temperature.toFixed(1) + 'C');
		console.log('Humidity:   ', readout.humidity.toFixed(1)    + '%');
		}
	// sensor.read(11, 36, function(err, temperature, humidity) {
    //     if (!err) {
	// 		return('温度: ' + temperature.toFixed(1) + '°C, ' +
    //             '湿度: ' + humidity.toFixed(1) + '%'
    //         );
    //     }
	// });  
}  
function initRPC() {
	led.open(Gpio.OUTPUT);
	led.open(Gpio.OUTPUT, Gpio.LOW);
	console.log('+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++');
	var composer = require('dloscore/composer.js');
	var network = require('dloscore/network.js');

	var rpc = require('json-rpc2');
	var walletDefinedByKeys = require('dloscore/wallet_defined_by_keys.js');
	var Wallet = require('dloscore/wallet.js');
	var balances = require('dloscore/balances.js');

	var server = rpc.Server.$create({
		'websocket': true, // is true by default 
		'headers': { // allow custom headers is empty by default 
			'Access-Control-Allow-Origin': '*'
		}
	});

	/**
	 * Returns information about the current state.
	 * @return { last_mci: {Integer}, last_stable_mci: {Integer}, count_unhandled: {Integer} }
	 */
	server.expose('getinfo', function(args, opt, cb) {
		var response = {};
		storage.readLastMainChainIndex(function(last_mci){
			response.last_mci = last_mci;
			storage.readLastStableMcIndex(db, function(last_stable_mci){
				response.last_stable_mci = last_stable_mci;
				db.query("SELECT COUNT(*) AS count_unhandled FROM unhandled_joints", function(rows){
					response.count_unhandled = rows[0].count_unhandled;
					cb(null, response);
				});
			});
		});
	});

	/**
	 * Validates address.
	 * @return {boolean} is_valid
	 */
	server.expose('validateaddress', function(args, opt, cb) {
		var address = args[0];
		cb(null, validationUtils.isValidAddress(address));
	});
	
	// alias for validateaddress
	server.expose('verifyaddress', function(args, opt, cb) {
		var address = args[0];
		cb(null, validationUtils.isValidAddress(address));
	});
	
	/**
	 * Creates and returns new wallet address.
	 * @return {String} address
	 */
	server.expose('getnewaddress', function(args, opt, cb) {
		mutex.lock(['rpc_getnewaddress'], function(unlock){
			walletDefinedByKeys.issueNextAddress(wallet_id, 0, function(addressInfo) {
				unlock();
				cb(null, addressInfo.address);
			});
		});
	});

	/**
	 * Returns address balance(stable and pending).
	 * If address is invalid, then returns "invalid address".
	 * If your wallet doesn`t own the address, then returns "address not found".
	 * @param {String} address
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 * 
	 * If no address supplied, returns wallet balance(stable and pending).
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getbalance', function(args, opt, cb) {
		let start_time = Date.now();
		var address = args[0];
		var asset = args[1];
		if (address) {
			if (validationUtils.isValidAddress(address))
				db.query("SELECT COUNT(*) AS count FROM my_addresses WHERE address = ?", [address], function(rows) {
					if (rows[0].count)
						db.query(
							"SELECT asset, is_stable, SUM(amount) AS balance \n\
							FROM outputs JOIN units USING(unit) \n\
							WHERE is_spent=0 AND address=? AND sequence='good' AND asset "+(asset ? "="+db.escape(asset) : "IS NULL")+" \n\
							GROUP BY is_stable", [address],
							function(rows) {
								var balance = {};
								balance[asset || 'base'] = {
									stable: 0,
									pending: 0
								};
								for (var i = 0; i < rows.length; i++) {
									var row = rows[i];
									balance[asset || 'base'][row.is_stable ? 'stable' : 'pending'] = row.balance;
								}
								cb(null, balance);
							}
						);
					else
						cb("address not found");
				});
			else
				cb("invalid address");
		}
		else
			Wallet.readBalance(wallet_id, function(balances) {
				console.log('getbalance took '+(Date.now()-start_time)+'ms');
				cb(null, balances);
			});
	});

	/**
	 * Returns wallet balance(stable and pending) without commissions earned from headers and witnessing.
	 * 
	 * @return {"base":{"stable":{Integer},"pending":{Integer}}} balance
	 */
	server.expose('getmainbalance', function(args, opt, cb) {
		let start_time = Date.now();
		balances.readOutputsBalance(wallet_id, function(balances) {
			console.log('getmainbalance took '+(Date.now()-start_time)+'ms');
			cb(null, balances);
		});
	});

	/**
	 * Returns transaction list.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address or {since_mci: {Integer}, unit: {String}} 
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 * 
	 * If no address supplied, returns wallet transaction list.
	 * @return [{"action":{'invalid','received','sent','moved'},"amount":{Integer},"my_address":{String},"arrPayerAddresses":[{String}],"confirmations":{0,1},"unit":{String},"fee":{Integer},"time":{String},"level":{Integer},"asset":{String}}] transactions
	 */
	server.expose('listtransactions', function(args, opt, cb) {
		let start_time = Date.now();
		if (Array.isArray(args) && typeof args[0] === 'string') {
			var address = args[0];
			if (validationUtils.isValidAddress(address))
				Wallet.readTransactionHistory({address: address}, function(result) {
					cb(null, result);
				});
			else
				cb("invalid address");
		}
		else{
			var opts = {wallet: wallet_id};
			if (args.unit && validationUtils.isValidBase64(args.unit, constants.HASH_LENGTH))
				opts.unit = args.unit;
			if (args.since_mci && validationUtils.isNonnegativeInteger(args.since_mci))
				opts.since_mci = args.since_mci;
			else
				opts.limit = 200;
			if (args.asset){
				if (!validationUtils.isValidBase64(args.asset, constants.HASH_LENGTH))
					return cb("bad asset: "+args.asset);
				opts.asset = args.asset;
			}
			Wallet.readTransactionHistory(opts, function(result) {
				console.log('listtransactions '+JSON.stringify(args)+' took '+(Date.now()-start_time)+'ms');
				cb(null, result);
			});
		}

	});

	/**
	 * Send funds to address.
	 * If address is invalid, then returns "invalid address".
	 * @param {String} address
	 * @param {Integer} amount
	 * @return {String} status
	 */
	server.expose('sendtoaddress', function(args, opt, cb) {
		console.log('sendtoaddress '+JSON.stringify(args));
		let start_time = Date.now();
		var amount = args[1];
		var toAddress = args[0];
		var asset = args[2];
		if (asset && !validationUtils.isValidBase64(asset, constants.HASH_LENGTH))
			return cb("bad asset: "+asset);
		if (amount && toAddress) {
			if (validationUtils.isValidAddress(toAddress))
				headlessWallet.issueChangeAddressAndSendPayment(asset, amount, toAddress, null, function(err, unit) {
					console.log('sendtoaddress '+JSON.stringify(args)+' took '+(Date.now()-start_time)+'ms, unit='+unit+', err='+err);
					cb(err, err ? undefined : unit);
				});
			else
				cb("invalid address");
		}
		else
			cb("wrong parameters");
	});

	headlessWallet.readSingleWallet(function(_wallet_id) {
		wallet_id = _wallet_id;
		// listen creates an HTTP server on localhost only 
		var httpServer = server.listen(conf.rpcPort, conf.rpcInterface);
		httpServer.timeout = 900*1000;
	});
	led.open(Gpio.OUTPUT, Gpio.HIGH);
}

eventBus.on('headless_wallet_ready', initRPC);

eventBus.on('text', function(from_address, text){
	var str=Date.now() + " -- "+ from_address+': '+text;
	console.log(str);
	if (str != temptext)
	{
		
		temptext=str;
		switch (text) {
			case "0":
				// led.toggle();
				led.open(Gpio.OUTPUT, Gpio.HIGH);
				//led.close(); 
				device.sendMessageToDevice(from_address, 'text', 'Off');
				//device.sendMessageToDevice(from_address, 'text', 'LED: '+led.read());
				break;
			case "1":
				led.open(Gpio.OUTPUT, Gpio.LOW);
				//led.close(); 
				device.sendMessageToDevice(from_address, 'text', 'On');
				//device.sendMessageToDevice(from_address, 'text', 'LED: '+led.read());
				break;		
			case "ip":
				device.sendMessageToDevice(from_address, 'text', 'My IP: '+getIPAdress());
				break;
			case "T":
				led.toggle();
				device.sendMessageToDevice(from_address, 'text', 'LED: '+led.read());
				break;				
			case "dht":
				device.sendMessageToDevice(from_address, 'text', dht11());
				break;

			default:
				device.sendMessageToDevice(from_address, 'text', 'Unknown command: \n'+text);
				break;
		}
// for(var i = 0; i < 20; i++){
//     led.toggle();  //切换 led 的电平状态
//     led.sleep(30);  //等待 500ms
// }


		//控制指令
	//	device.sendMessageToDevice(from_address, 'text', '非IOT设备\n\r'+str);
	}



});
