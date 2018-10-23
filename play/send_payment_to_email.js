/*jslint node: true */
"use strict";
var headlessWallet = require('../start.js');
var eventBus = require('dloscore/event_bus.js');
var mail = require('dloscore/mail.js');
var conf = require('dloscore/conf.js');

const asset = null;
const amount = 1000;
const to_address = 'textcoin:pandanation@wwfus.org';
const email_subject = "Textcoin from headless wallet";

let opts = {
	asset: asset, 
	amount: amount, 
	to_address: to_address,
	email_subject: email_subject
};

function pay(){
	headlessWallet.issueChangeAddressAndSendMultiPayment(opts, (err, unit, assocMnemonics) => {
		console.error("=== sent payment, unit="+unit+", err="+err, assocMnemonics);
	});
}

eventBus.on('headless_wallet_ready', pay);

headlessWallet.setupChatEventHandlers();
