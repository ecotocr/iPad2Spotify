/* ES5/XHR only: compatible with Safari on iOS 9. */
(function () {
  'use strict';
  var current = null, timer, minimalist = false, seeking = false, lyricsVisible = false, lyricsTrackId = null, lyricsRequestTrackId = null, lyricsCache = null, winamp = null, WINAMP_KEY = 'ipad2spotify.winampMode';
  function id(name){return document.getElementById(name)}
  function message(text){id('message').innerHTML=text}
function request(method,url,body,done){if(url.charAt(0)==='/')url=location.protocol+'//'+location.host+url;var x=new XMLHttpRequest();var called=false;function finish(status,data){if(called)return;called=true;done(status,data)}x.open(method,url,true);if(body)x.setRequestHeader('Content-Type','application/json');x.timeout=120000;x.onreadystatechange=function(){if(x.readyState===4){var d={};try{d=JSON.parse(x.responseText||'{}')}catch(e){}if(x.status===0){setTimeout(function(){finish(0,d)},0)}else finish(x.status,d)}};x.ontimeout=function(){finish(0,{error:'Request timed out.'})};x.onerror=function(){finish(0,{error:'Could not reach the server.'})};x.send(body?JSON.stringify(body):null)}
  function showPlayer(){id('setup').className='card hidden';id('player').className='player'+(lyricsVisible?' lyrics-visible':'');id('status').innerHTML='Connected';storageSet(WINAMP_KEY,null);poll()}
  function pair(){var code=id('pairing-code').value.replace(/[^a-z0-9]/ig,'').toUpperCase();if(!code){message('Enter the code shown in Safari after Spotify login.');return}message('Pairing this fullscreen app…');request('POST','/api/auth/pair',{code:code},function(status,data){if(status===200){message('');showPlayer()}else if(status===0)message('Could not reach the server. Check the connection and try again.');else message((data&&data.error)||('Pairing failed (status '+status+'). Try a new code.'))})}
  function login(){window.location.href='/api/auth/login'}
  function formatTime(ms){if(!ms||ms<0)ms=0;var totalSec=Math.floor(ms/1000),m=Math.floor(totalSec/60),s=totalSec%60;return m+':'+(s<10?'0':'')+s}
  function setLoading(loading){var indicator=id('loading-indicator');if(indicator)indicator.className=loading?'loading-indicator':'loading-indicator hidden';var refresh=id('refresh');if(refresh){refresh.disabled=loading;refresh.className='icon-action refresh-action'+(loading?' is-loading':'');refresh.setAttribute('aria-label',loading?'Checking playback':'Refresh playback')}}
  function playerMessage(text){var target=id('player-message-text');if(target)target.innerHTML=text;else id('player-message').innerHTML=text}
  function schedulePoll(delay){if(timer)clearTimeout(timer);timer=setTimeout(poll,delay)}
  function pollDelay(data){var item=data&&data.item;if(!item)return 60000;if(!data.is_playing)return 60000;var duration=item.duration_ms||0,progress=data.progress_ms||0,remaining=duration-progress;if(remaining>0&&remaining<=60000)return Math.max(10000,Math.min(30000,remaining-3000));return 30000}
  function updateTimeline(){var slider=id('timeline-slider');if(!current||!current.item){slider.max=1;slider.value=0;slider.disabled=true;id('time-elapsed').innerHTML='0:00';id('time-duration').innerHTML='0:00';return}var duration=current.item.duration_ms||0,elapsed=current.progress_ms||0;if(current.is_playing)elapsed+=Date.now()-current.fetched_at;if(elapsed>duration)elapsed=duration;slider.max=duration||1;slider.disabled=!duration;if(!seeking)slider.value=Math.floor(elapsed);else elapsed=parseInt(slider.value,10)||0;id('time-elapsed').innerHTML=formatTime(elapsed);id('time-duration').innerHTML=formatTime(duration)}
  // Signal the Winamp module (via the bridge) that live audio-analysis should
  // drive the visualizer. The render loop itself is owned by winamp.js.
  function startWinampVisualizer() {
    if (window.winampVisStart) window.winampVisStart();
  }
  function stopWinampVisualizer() {
    if (window.winampVisStop) window.winampVisStop();
  }

  function setPlaying(isPlaying){id('play').className=isPlaying?'play icon-play is-playing':'play icon-play';if(isPlaying&&winamp&&winamp.isActive()){startWinampVisualizer()}else{stopWinampVisualizer()}}
  function resetLyrics(keepVisible){
    lyricsVisible=!!(keepVisible&&lyricsVisible);
    lyricsTrackId=null;
    lyricsRequestTrackId=null;
    lyricsCache=null;
    id('player').className='player'+(lyricsVisible?' lyrics-visible':'');
    id('art-frame').className=lyricsVisible?'art lyrics-visible':'art';
    id('art-tap').setAttribute('aria-expanded',lyricsVisible?'true':'false');
    id('art-tap').setAttribute('aria-label',lyricsVisible?'Show album artwork':'Show lyrics');
    id('lyrics-close').setAttribute('aria-label','Show album artwork');
    id('lyrics-panel').className=lyricsVisible?'lyrics-panel':'lyrics-panel hidden';
    id('lyrics-status').innerHTML='Loading lyrics…';
    id('lyrics-status').className='';
    id('lyrics-text').textContent='';
    id('lyrics-text').className='hidden';
  }
  function showLyrics(lyrics){
    id('lyrics-status').className='hidden';
    id('lyrics-text').textContent=lyrics;
    id('lyrics-text').className='';
  }
  function fetchLyrics(item,trackId){
    if(lyricsTrackId===trackId&&lyricsCache!==null){showLyrics(lyricsCache);return}
    lyricsTrackId=trackId;
    lyricsRequestTrackId=trackId;
    id('lyrics-status').innerHTML='Loading lyrics…';
    id('lyrics-status').className='';
    id('lyrics-text').className='hidden';
    var artist=item.artists.map(function(a){return a.name}).join(', ');
    request('GET','/api/spotify/currently-playing?lyrics=1&artist='+encodeURIComponent(artist)+'&title='+encodeURIComponent(item.name),null,function(status,data){
      if(lyricsRequestTrackId!==trackId||!current||!current.item||current.item.id!==trackId)return;
      lyricsRequestTrackId=null;
      if(status!==200){id('lyrics-status').textContent=(data&&data.error)||'Could not load lyrics.';return}
      lyricsCache=typeof data.lyrics==='string'?data.lyrics:'';
      if(!lyricsCache){id('lyrics-status').textContent='Lyrics were not found for this track.';return}
      showLyrics(lyricsCache);
    });
  }
  function toggleLyrics(){
    if(!current||!current.item)return;
    lyricsVisible=!lyricsVisible;
    id('player').className='player'+(lyricsVisible?' lyrics-visible':'');
    id('art-frame').className=lyricsVisible?'art lyrics-visible':'art';
    id('art-tap').setAttribute('aria-expanded',lyricsVisible?'true':'false');
    id('art-tap').setAttribute('aria-label',lyricsVisible?'Show album artwork':'Show lyrics');
    id('lyrics-close').setAttribute('aria-label','Show album artwork');
    id('lyrics-panel').className=lyricsVisible?'lyrics-panel':'lyrics-panel hidden';
    if(lyricsVisible)fetchLyrics(current.item,current.item.id);
  }
  function artworkTap(){
    if(minimalist)toggleLyrics();
  }
  function render(data){
    var item=data&&data.item;
    if(!item){
      id('title').innerHTML='Nothing playing';
      id('artist').className='empty-state';
      id('artist').innerHTML='No active track detected. Automatic checks are spaced up to 60 seconds to reduce server usage. Use the refresh button to check immediately.';
      id('album').innerHTML='';
      id('minimalist-artist').innerHTML='';
      id('minimalist-title').innerHTML='';
      id('art').style.display='none';
      id('placeholder').className='';
      resetLyrics(false);
      setPlaying(false);
      current=null;
      updateTimeline();
      if(winamp)winamp.update(null);
      if(window.audioClock){window.audioClock.pause();window.audioClock.setPausedAt(0);}
      return;
    }
    var trackId=item.id;
    var isSameTrack=current&&current.item&&current.item.id===trackId;
    if(!isSameTrack){
      resetLyrics(true);
      window.currentTrackId=trackId;
    }
    if(window.audioClock){
      if(data.is_playing){window.audioClock.setProgress(data.progress_ms||0);window.audioClock.resume();}
      else{window.audioClock.pause();window.audioClock.setPausedAt(data.progress_ms||0);}
    }
    current=data;
    current.fetched_at=Date.now();
    var artist=item.artists.map(function(a){return a.name}).join(', ');
    id('title').innerHTML=item.name;
    id('artist').className='';
    id('artist').innerHTML=artist;
    id('album').innerHTML=item.album.name;
    id('minimalist-artist').innerHTML=artist;
    id('minimalist-title').innerHTML=item.name;
    setPlaying(!!data.is_playing);
    if(winamp)winamp.update(data);
    if(item.album.images&&item.album.images.length){
      id('art').src=item.album.images[0].url;
      id('art').style.display='block';
      id('placeholder').className='hidden';
    }
    if(lyricsVisible)fetchLyrics(item,trackId);
    updateTimeline();
  }
  function poll(){if(document.hidden){return}setLoading(true);request('GET','/api/spotify/currently-playing',null,function(status,data){setLoading(false);if(status===200){render(data);playerMessage(data&&data.item?'Playback updated.':'No active track. Automatic checks resume within 60 seconds.');schedulePoll(pollDelay(data))}else if(status===401){id('status').innerHTML='Not connected';playerMessage(data.error||'Pair again.');schedulePoll(60000)}else{playerMessage('Waiting for Spotify…');schedulePoll(60000)}})}
  function command(action,positionMs){if(action==='previous'&&current)action=window.playbackControls.previousAction(current,Date.now());var body={action:action};if(action==='seek')body.position_ms=positionMs;request('POST','/api/spotify/command',body,function(status,data){if(status!==200)id('player-message').innerHTML=data.error||'Command failed';else if(action==='seek'&&current){current.progress_ms=positionMs;current.fetched_at=Date.now()}schedulePoll(750)})}
  setInterval(updateTimeline,1000);
  function closeBadgeModal(){id('badge-modal').className='modal hidden'}
  function createBadge(){var url = '/api/badge/create?badgeId='+Date.now(); request('POST', url, {}, function(status,data){if(status===200){var markdown='[![Last played on Spotify]('+data.url+')]('+window.location.origin+'/)';id('badge-preview').src=data.url+'?t='+Date.now();id('badge-code').value=markdown;id('badge-modal').className='modal';id('badge-code').focus();id('badge-code').select()}else id('player-message').innerHTML=data.error||'Could not create badge.'})}
  function escapeHtml(text){return text.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function openArtistModal(){id('artist-modal').className='modal';switchSearchMode('artist');id('artist-query').value='';id('playlist-query').value='';id('artist-results').innerHTML='';id('artist-message').innerHTML='';id('artist-query').focus()}
  function closeArtistModal(){id('artist-modal').className='modal hidden'}
  function loadDevices(){id('devices-now-playing').textContent='Checking playback device…';id('devices-list').innerHTML='';id('devices-refresh').disabled=true;request('GET','/api/spotify/currently-playing?devices=1',null,function(status,data){id('devices-refresh').disabled=false;if(status!==200){id('devices-now-playing').textContent=(data&&data.error)||'Could not load Spotify playback devices.';return}var devices=data.devices||[];id('devices-now-playing').textContent=data.playing_device_name?'Currently playing on: '+data.playing_device_name+'.':'No track is currently playing.';if(!devices.length){id('devices-list').innerHTML='<p class="message">No Spotify devices are currently available.</p>';return}var html='';for(var i=0;i<devices.length;i++){var device=devices[i],isPlaying=!!data.playing_device_id&&device.id===data.playing_device_id,statusText=isPlaying?'Playing now':device.is_active?'Active':'Available';html+='<div class="device-entry"><span class="device-status">'+statusText+'</span><div class="device-name">'+escapeHtml(device.name)+'</div><div class="device-meta">'+escapeHtml(device.type)+(device.is_restricted?' · Not available for playback control':'')+'</div></div>'}id('devices-list').innerHTML=html})}
  function openDevicesModal(){id('devices-modal').className='modal';loadDevices()}
  function closeDevicesModal(){id('devices-modal').className='modal hidden'}
  function switchSearchMode(type){var isPlaylist=type==='playlist';id('search-tab-artist').className=isPlaylist?'search-tab':'search-tab search-tab-active';id('search-tab-playlist').className=isPlaylist?'search-tab search-tab-active':'search-tab';id('artist-query-label').className=isPlaylist?'hidden':'';id('playlist-query-label').className=isPlaylist?'':'hidden';var artistField=id('artist-query'),playlistField=id('playlist-query');artistField.className=isPlaylist?'hidden':'';playlistField.className=isPlaylist?'':'hidden';artistField.value='';playlistField.value='';id('artist-results').innerHTML='';id('artist-message').innerHTML='';(isPlaylist?playlistField:artistField).focus()}
  function searchArtist(){var mode=id('search-tab-playlist').className.indexOf('search-tab-active')!==-1?'playlist':'artist';var q=(mode==='playlist'?id('playlist-query'):id('artist-query')).value.trim();if(!q){id('artist-message').innerHTML='Enter a'+(mode==='playlist'?' playlist name':'n artist name')+'.';return}id('artist-message').innerHTML='Searching…';id('artist-results').innerHTML='';var endpoint='/api/spotify/search-'+(mode==='playlist'?'playlist':'artist')+'?q='+encodeURIComponent(q);request('GET',endpoint,null,function(status,data){var key=mode==='playlist'?'playlists':'artists';if(status!==200){id('artist-message').innerHTML=data.error||'Search failed.';return}var items=data[key]||[];if(!items.length){id('artist-message').innerHTML='No '+(mode==='playlist'?'playlists':'artists')+' found.';return}id('artist-message').innerHTML='';var html='';for(var i=0;i<items.length;i++){html+='<button type="button" class="artist-result" data-id="'+items[i].id+'">'+escapeHtml(items[i].name)+'</button>'}id('artist-results').innerHTML=html;var buttons=id('artist-results').getElementsByTagName('button');for(var j=0;j<buttons.length;j++){buttons[j].onclick=function(){playTarget(mode,this.getAttribute('data-id'),this.innerHTML)}}})}
  function playTarget(mode,itemId,name){var noun=mode==='playlist'?'playlist':'artist radio';id('artist-message').innerHTML='Starting '+name+' ('+noun+')…';var body={action:mode==='playlist'?'play_playlist':'play_artist'};body[mode==='playlist'?'playlist_id':'artist_id']=itemId;request('POST','/api/spotify/command',body,function(status,data){if(status!==200){id('artist-message').innerHTML=data.error||'Could not start '+noun+'.';schedulePoll(750);return}closeArtistModal();schedulePoll(750)})}
  function enterMinimalist(){minimalist=true;document.body.className='minimalist';id('minimalist').setAttribute('aria-label','Regular view');id('minimalist').setAttribute('title','Regular view')}
  function exitMinimalist(){minimalist=false;document.body.className='';id('minimalist').setAttribute('aria-label','Minimalist view');id('minimalist').setAttribute('title','Minimalist view')}
  function storage(){try{return window.localStorage}catch(e){return null}}
  function storageGet(key){try{return storage().getItem(key)}catch(e){return null}}
  function storageSet(key,value){try{if(value)storage().setItem(key,value);else storage().removeItem(key)}catch(e){}}
  function winampView(){if(!winamp&&window.WinampMode){winamp=window.WinampMode.create({root:id('winamp'),storage:storage(),onCommand:command,onEject:openArtistModal,onExit:exitWinamp});if(current)winamp.update(current)}return winamp}
  function enterWinamp(){var view=winampView();if(!view)return;view.show();setPlaying(!!(current&&current.is_playing));storageSet(WINAMP_KEY,'1')}
  function exitWinamp(){stopWinampVisualizer();if(winamp)winamp.hide();storageSet(WINAMP_KEY,null)}
  function openDisconnectModal(){id('disconnect-message').textContent='';id('disconnect-confirm').disabled=false;id('disconnect-modal').className='modal'}
  function closeDisconnectModal(){id('disconnect-modal').className='modal hidden'}
  function confirmDisconnect(){var button=id('disconnect-confirm');button.disabled=true;id('disconnect-message').textContent='Disconnecting…';request('POST','/api/auth/logout',null,function(status,data){if(status===200){location.reload();return}button.disabled=false;id('disconnect-message').textContent=(data&&data.error)||'Could not disconnect. Please try again.'})}
  function visibilityChanged(){if(document.hidden){if(timer)clearTimeout(timer);timer=null}else if(!id('player').className.match(/hidden/)){schedulePoll(0)}}
  id('login').onclick=login;id('pair').onclick=pair;id('pairing-code').onkeyup=function(e){if(e&&e.keyCode===13)pair()};id('previous').onclick=function(){command('previous')};id('next').onclick=function(){command('next')};id('play').onclick=function(){command(current&&current.is_playing?'pause':'play')};id('refresh').onclick=function(){schedulePoll(0)};id('minimalist').onclick=function(){if(minimalist)exitMinimalist();else enterMinimalist()};id('minimalist-exit').onclick=exitMinimalist;id('timeline-slider').oninput=function(){seeking=true;id('time-elapsed').innerHTML=formatTime(parseInt(this.value,10)||0)};id('timeline-slider').onchange=function(){var position=parseInt(this.value,10)||0;seeking=false;if(current&&current.item)command('seek',position)};id('badge-close').onclick=closeBadgeModal;id('art-tap').onclick=function(){if(minimalist)artworkTap();else toggleLyrics()};id('lyrics-close').onclick=function(e){if(e&&e.stopPropagation)e.stopPropagation();toggleLyrics()};id('disconnect').onclick=openDisconnectModal;id('disconnect-confirm').onclick=confirmDisconnect;id('disconnect-cancel').onclick=closeDisconnectModal;id('search-artist').onclick=openArtistModal;id('devices').onclick=openDevicesModal;id('devices-refresh').onclick=loadDevices;id('devices-close').onclick=closeDevicesModal;id('search-tab-artist').onclick=function(){switchSearchMode('artist')};id('search-tab-playlist').onclick=function(){switchSearchMode('playlist')};id('artist-search-go').onclick=searchArtist;id('artist-cancel').onclick=closeArtistModal;id('artist-query').onkeyup=function(e){if(e&&e.keyCode===13)searchArtist()};id('playlist-query').onkeyup=function(e){if(e&&e.keyCode===13)searchArtist()};document.addEventListener('visibilitychange',visibilityChanged,false);
  request('GET','/api/spotify/currently-playing',null,function(status){if(status===200)showPlayer()});
}());
