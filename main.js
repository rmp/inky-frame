const sharp = require('sharp')
const inky = require('@aeroniemi/inky')
const frame = new inky.Impression73()
const fn = process.argv[2]
if(!fn) {
	throw new Error("specify filename to display")
}

console.log(fn);

sharp(fn)
//  .resize(800, 480)
  .toFile('output.png', (err, info) => {
	frame.display_png('output.png')
	frame.show()
})
