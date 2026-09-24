import('./src/skills/spotify.js').then(s => s.execute({action: 'play', query: 'Bad Bunny'})).then(console.log).catch(console.error);
