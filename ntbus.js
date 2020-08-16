#!/usr/bin/env node

require('dotenv').config()
const util = require('util')
const snmp = require('net-snmp')
const fetch = require('node-fetch')
const MbusMaster = require('node-mbus')
const fs = require('fs')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const SegfaultHandler = require('segfault-handler')
SegfaultHandler.registerHandler('crash.log')

const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({ convertors: [] }).write()

let DEBUG = false
const args = process.argv

const commands = ['new', 'get', 'complete', 'help']

const usage = function () {
  const usageText = `
  ntbus Get MBus Electricity Values.

  usage:
    ntbus [options] <command>

		options:
		-d: 			debug

    commands can be:

    scan:     used to scan convertors in your inventory.json.
    query:    used to query secondary Ids found via scan.
    reset: 		used to clear DB and start over.
    help:     used to print the usage guide.
  `
  console.log(usageText)
}

if (args.length > 3) {
  console.error(`only one argument can be accepted`)
  usage()
}

if (args[2] === '-d') {
  if (commands.indexOf(args[3]) == -1) {
    console.error('invalid command passed')
    usage()
  }
} else if (commands.indexOf(args[2]) == -1) {
  console.error('invalid command passed')
  usage()
}

const getInventory = () => {
  const rawdata = fs.readFileSync(`${__dirname}/inventory.json`)
  const mbus = JSON.parse(rawdata)
  return mbus
}

const mbusInit = (host, port = 1234) => {
  const mbusOptions = {
    host: host,
    port: port,
    timeout: 100,
    autoConnect: false,
  }
  let mbusMaster
  mbusMaster = new MbusMaster(mbusOptions)

  mbusMaster.connect()
  if (!mbusMaster.connect()) {
    mbusOptions.port = 1470
    mbusMaster = new MbusMaster(mbusOptions)
    mbusMaster.connect()
    if (!mbusMaster.connect()) {
      console.error('Connection failed.')
      return false
    }
  } else {
    DEBUG && console.log(mbusMaster)
  }

  return mbusMaster
}

const mbusScan = async () => {
  const mbus = getInventory()
  mbus.convertors.map(async ip => {
    const master = mbusInit(ip, 1234)
    if (!db.get('convertors').find({ ip: ip }).value()) {
      master.scanSecondary(async (err, scanResult) => {
        if (err) {
          console.log('err: ' + err)
          reject(err)
        }

        DEBUG && console.log('result1:', scanResult)

        db.get('convertors')
          .push({ ip: master.options.host, feeds: scanResult })
          .write()
      })
    }
  })
}

const mbusQuery = () => {
  const mbus = getInventory()
  mbus.convertors.map(async conv => {
    const master = mbusInit(conv.ip, 1234)
    conv.feeds.map(feed => {
      master.getData(feed, (err, mbusData) => {
        if (err) {
          console.log('err: ' + err)
          return false
        }
        const feedNr = feed.substr(0, 8)
        fetch(
          `https://racks.newtelco.de/api/dcim/power-feeds/?name=${feedNr}`,
          {
            headers: {
              Accept: 'application/json',
              Authorization: `TOKEN ${process.env.NETBOX_TOKEN}`,
            },
          }
        )
          .then(data => data.json())
          .then(data => {
            console.log(data.results[0].id, mbusData)
            // return { feed: feed, nbId: data.results[0].id }
          })
      })
    })
  })
}

switch (args[2]) {
  case '-d':
    DEBUG = true
    switch (args[3]) {
      case 'help':
        usage()
        break
      case 'scan':
        mbusScan()
        break
      case 'query':
        mbusQuery()
        break
      case 'reset':
        break
      default:
        console.error('invalid command passed')
        usage()
    }
  case 'help':
    usage()
    break
  case 'scan':
    mbusScan()
    break
  case 'query':
    mbusQuery()
    break
  case 'reset':
    break
  default:
    console.error('invalid command passed')
    usage()
}
