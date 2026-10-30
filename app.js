/* ES5/XHR only: compatible with Safari on iOS 9. */
(function () {
  'use strict';
  var current = null, timer, pollGeneration = 0, minimalist = false, seeking = false, changingVolume = false, volumeDeviceId = null, playbackDeviceId = null, optimisticPlaybackUntil = 0, volumeUnsupportedDeviceId = null, volumeValue = 50, confirmedVolumeValue = 50, volumeKnown = false, lyricsVisible = false, lyricsTrackId = null, lyricsRequestTrackId = null, lyricsCache = null, winamp = null, activeProfileId = null, playlistId = null, playlistNextOffset = null, playlistCurrentUri = null, WINAMP_KEY = 'ipad2spotify.winampMode';
  function id(name){return document.getElementById(name)}
  function message(text){id('message').textContent=text}
function request(method,url,body,done){if(url.charAt(0)==='/')url=location.protocol+'//'+location.host+url;var x=new XMLHttpRequest();var called=false;function finish(status,data){if(called)return;called=true;done(status,data)}x.open(method,url,true);if(body)x.setRequestHeader('Content-Type','application/json');x.timeout=120000;x.onreadystatechange=function(){if(x.readyState===4){var d={};try{d=JSON.parse(x.responseText||'{}')}catch(e){}if(x.status===0){setTimeout(function(){finish(0,d)},0)}else finish(x.status,d)}};x.ontimeout=function(){finish(0,{error:'Request timed out.'})};x.onerror=function(){finish(0,{error:'Could not reach the server.'})};x.send(body?JSON.stringify(body):null)}
  function renderProfiles(profiles){var list=id('profile-list'),addButton=id('add-profile');list.innerHTML='';for(var i=0;i<profiles.length;i++){(function(profile){var button=document.createElement('button');button.type='button';button.className='profile-card';button.setAttribute('aria-label','Use '+profile.display_name);var avatar=document.createElement('span');avatar.className='profile-avatar';var fallback=document.createElement('span');fallback.className='profile-avatar-fallback';fallback.textContent=(profile.display_name||'S').charAt(0).toUpperCase();avatar.appendChild(fallback);if(profile.avatar_url){var image=document.createElement('img');image.alt='';image.src='/api/auth/pair?avatar='+encodeURIComponent(profile.id);image.onerror=function(){image.style.display='none'};avatar.appendChild(image)}var name=document.createElement('span');name.className='profile-name';name.textContent=profile.display_name;button.appendChild(avatar);button.appendChild(name);button.onclick=function(){selectProfile(profile.id,button)};list.appendChild(button)})(profiles[i])}addButton.className='profile-card profile-add';list.appendChild(addButton)}
  function showProfiles(profiles){pollGeneration++;if(timer)clearTimeout(timer);timer=null;if(winamp)exitWinamp();if(minimalist)exitMinimalist();volumeDeviceId=null;playbackDeviceId=null;optimisticPlaybackUntil=0;volumeUnsupportedDeviceId=null;volumeValue=50;confirmedVolumeValue=50;id('setup').className='card hidden';render({item:null});id('player').className='player hidden';id('profiles').className='profile-picker';id('status').textContent='Select profile';id('refresh').className='icon-action refresh-action hidden';renderProfiles(profiles||[])}
  function loadProfiles(){id('profile-message').textContent='Loading profiles…';request('GET','/api/auth/pair',null,function(status,data){if(status!==200){showProfiles([]);id('profile-message').textContent=(data&&data.error)||'Could not load profiles.';return}var profiles=data.profiles||[],warnings=parseInt(data.profile_warning_count,10)||0;showProfiles(profiles);id('profile-message').textContent=warnings?'Spotify could not refresh details for '+warnings+' account(s).':profiles.length?'':'No profiles yet. Add one to get started.'})}
  function showPlayer(){pollGeneration++;current=null;id('profiles').className='profile-picker hidden';id('setup').className='card hidden';id('player').className='player'+(lyricsVisible?' lyrics-visible':'');id('status').textContent='Connected';storageSet(WINAMP_KEY,null);poll()}
  function selectProfile(profileId,button){button.disabled=true;id('profile-message').textContent='Connecting…';request('POST','/api/auth/pair',{profile_id:profileId},function(status,data){if(status===200){activeProfileId=profileId;id('profile-message').textContent='';showPlayer()}else{button.disabled=false;id('profile-message').textContent=(data&&data.error)||'Could not select this profile.'}})}
  function openRemoveProfileModal(){if(!activeProfileId){playerMessage('No active Spotify profile is selected.');return}id('remove-profile-message').textContent='This removes the selected profile from this iPad only. Spotify authorization will not be revoked.';id('remove-profile-confirm').disabled=false;id('remove-profile-modal').className='modal'}
  function closeRemoveProfileModal(){id('remove-profile-modal').className='modal hidden'}
  function removeProfile(){if(!activeProfileId){closeRemoveProfileModal();playerMessage('No active Spotify profile is selected.');return}var button=id('remove-profile-confirm');button.disabled=true;id('remove-profile-message').textContent='Removing profile…';request('POST','/api/auth/pair',{remove_profile_id:activeProfileId},function(status,data){if(status!==200){button.disabled=false;id('remove-profile-message').textContent=(data&&data.error)||'Could not remove this profile.';return}activeProfileId=null;closeRemoveProfileModal();showProfiles(data.profiles||[]);id('profile-message').textContent='Profile removed from this iPad.'})}
  function pair(){var code=id('pairing-code').value.replace(/[^a-z0-9]/ig,'').toUpperCase();if(!code){message('Enter the code shown after Spotify login.');return}message('Adding Spotify profile…');id('pair').disabled=true;request('POST','/api/auth/pair',{code:code},function(status,data){id('pair').disabled=false;if(status===200){id('pairing-code').value='';message('');loadProfiles();return}if(status===0)message('Could not reach the server. Check the connection and try again.');else message((data&&data.error)||('Pairing failed (status '+status+'). Try a new code.'))})}
  function login(){window.location.href='/api/auth/login'}
  function openAddProfile(){id('profiles').className='profile-picker hidden';id('setup').className='card';id('profile-message').textContent='';id('pairing-code').focus()}
  function closeAddProfile(){id('setup').className='card hidden';id('profiles').className='profile-picker';message('')}
  function returnToProfiles(event){if(event&&event.preventDefault)event.preventDefault();showProfiles([]);loadProfiles()}
  function formatTime(ms){if(!ms||ms<0)ms=0;var totalSec=Math.floor(ms/1000),m=Math.floor(totalSec/60),s=totalSec%60;return m+':'+(s<10?'0':'')+s}
  function setLoading(loading){var indicator=id('loading-indicator');if(indicator)indicator.className=loading?'loading-indicator':'loading-indicator hidden';var refresh=id('refresh');if(refresh){refresh.disabled=loading;refresh.className='icon-action refresh-action'+(loading?' is-loading':'');refresh.setAttribute('aria-label',loading?'Checking playback':'Refresh playback')}}
  function playerMessage(text){var target=id('player-message-text');if(target)target.textContent=text;else id('player-message').textContent=text}
  function playbackError(status,data){var error=data&&data.error,detail=typeof error==='string'?error:error&&typeof error.message==='string'?error.message:data&&typeof data.message==='string'?data.message:'';return detail?'Spotify request failed (HTTP '+status+'): '+detail:'Spotify request failed (HTTP '+status+'). Check that playback is active for this selected Spotify account.'}
  function playlistError(data,fallback){var error=data&&data.error;return typeof error==='string'?error:error&&typeof error.message==='string'?error.message:error&&typeof error.reason==='string'?error.reason:fallback}
  function schedulePoll(delay){if(timer)clearTimeout(timer);timer=setTimeout(poll,delay)}
  function pollDelay(data){var item=data&&data.item;if(!item)return 60000;if(!data.is_playing)return 60000;var duration=item.duration_ms||0,progress=data.progress_ms||0,remaining=duration-progress;if(remaining>0&&remaining<=60000)return Math.max(10000,Math.min(30000,remaining-3000));return 30000}
  function updateVolumeControl(){var slider=id('volume-slider'),level=id('volume-level'),device=current&&current.device,volume=device&&device.volume_percent;if(device&&device.id)volumeDeviceId=device.id;if(typeof volume==='number'&&volume>=0&&volume<=100){volumeValue=volume;confirmedVolumeValue=volume;volumeKnown=true}var deviceId=device&&device.id||volumeDeviceId,canControlVolume=!(device&&device.supports_volume===false)&&!(volumeUnsupportedDeviceId&&volumeUnsupportedDeviceId===deviceId);slider.disabled=!canControlVolume;id('volume-down').disabled=!canControlVolume;id('volume-up').disabled=!canControlVolume;id('volume-message').textContent=canControlVolume?'':'Spotify does not allow this device’s volume to be changed from the app. Use the device’s own volume controls.';if(!changingVolume)slider.value=volumeValue;level.innerHTML=volumeValue+'%'}
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
      updateVolumeControl();
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
    if(current.device&&current.device.id)playbackDeviceId=current.device.id;
    updateVolumeControl();
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
  function poll(){var generation=pollGeneration;if(document.hidden||id('player').className.indexOf('hidden')!==-1){return}setLoading(true);request('GET','/api/spotify/currently-playing',null,function(status,data){if(generation!==pollGeneration||id('player').className.indexOf('hidden')!==-1)return;setLoading(false);if(status===200){if(!data.item&&current&&current.item&&Date.now()<optimisticPlaybackUntil){playerMessage('Starting playback…');schedulePoll(1500);return}if(data.item)optimisticPlaybackUntil=0;render(data);playerMessage(data&&data.item?'Playback updated.':'No active track. Automatic checks resume within 60 seconds.');schedulePoll(pollDelay(data))}else if(status===401){id('status').textContent='Not connected';playerMessage((data&&data.error)||'Pair again.');schedulePoll(60000)}else{playerMessage(playbackError(status,data));schedulePoll(60000)}})}
  function command(action,value,deviceId){if(action==='previous'&&current)action=window.playbackControls.previousAction(current,Date.now());var body={action:action};if(action==='seek')body.position_ms=value;if(action==='volume'){body.volume_percent=value;if(deviceId||volumeDeviceId)body.device_id=deviceId||volumeDeviceId}else if(action!=='transfer_device'&&(deviceId||playbackDeviceId)){body.device_id=deviceId||playbackDeviceId}request('POST','/api/spotify/command',body,function(status,data){if(status!==200){if(action==='volume'){volumeValue=confirmedVolumeValue;changingVolume=false;if(data&&data.code==='DEVICE_VOLUME_UNSUPPORTED'){volumeDeviceId=data.device_id||deviceId||volumeDeviceId;volumeUnsupportedDeviceId=volumeDeviceId}updateVolumeControl()}id('player-message').innerHTML=(data&&data.error)||'Command failed'}else{if(data&&data.device_id){playbackDeviceId=data.device_id;if(current){current.device=current.device||{};current.device.id=data.device_id} }if(action==='seek'&&current){current.progress_ms=value;current.fetched_at=Date.now()}else if(action==='volume'){volumeValue=value;confirmedVolumeValue=value;volumeKnown=true;if(current&&current.device&&current.device.id=== (deviceId||volumeDeviceId))current.device.volume_percent=value;updateVolumeControl()}}schedulePoll(750)})}
  function changeVolumeBy(delta){var slider=id('volume-slider');var volume=Math.max(0,Math.min(100,(parseInt(slider.value,10)||0)+delta));slider.value=volume;id('volume-level').innerHTML=volume+'%';command('volume',volume,volumeDeviceId)}
  setInterval(updateTimeline,1000);
  function closeBadgeModal(){id('badge-modal').className='modal hidden'}
  function createBadge(){var url = '/api/badge/create?badgeId='+Date.now(); request('POST', url, {}, function(status,data){if(status===200){var markdown='[![Last played on Spotify]('+data.url+')]('+window.location.origin+'/)';id('badge-preview').src=data.url+'?t='+Date.now();id('badge-code').value=markdown;id('badge-modal').className='modal';id('badge-code').focus();id('badge-code').select()}else id('player-message').innerHTML=data.error||'Could not create badge.'})}
  function escapeHtml(text){return text.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function openArtistModal(){id('artist-modal').className='modal';switchSearchMode('artist');id('artist-query').value='';id('playlist-query').value='';id('artist-results').innerHTML='';id('artist-message').innerHTML='';id('artist-query').focus()}
  function closeArtistModal(){id('artist-modal').className='modal hidden'}
  function loadDevices(){id('devices-feedback').textContent='';id('devices-list').innerHTML='';id('devices-refresh').disabled=true;request('GET','/api/spotify/currently-playing?devices=1',null,function(status,data){id('devices-refresh').disabled=false;if(status!==200){id('devices-feedback').textContent=(data&&data.error)||'Could not load Spotify playback devices.';return}var devices=data.devices||[];if(!devices.length){id('devices-list').innerHTML='<p class="message">No Spotify devices are currently available.</p>';return}var playingDevice=current&&current.is_playing&&current.device?current.device:null,playingId=playingDevice&&playingDevice.id,activeDevice=null,matchedDevice=null;var html='';for(var i=0;i<devices.length;i++){var device=devices[i],isPlaying=!!playingId&&device.id===playingId,statusText=isPlaying?'Playing now':device.is_active?'Active':'Available',disabled=device.is_restricted||!device.id; if(device.is_active&&!activeDevice)activeDevice=device;if(playingId&&device.id===playingId)matchedDevice=device;html+='<button type="button" class="device-entry'+(disabled?' device-unavailable':'')+'" data-device-id="'+escapeHtml(device.id||'')+'" '+(disabled?'disabled':'')+'><span class="device-status">'+statusText+'</span><span class="device-name">'+escapeHtml(device.name)+' - '+escapeHtml(device.type)+'</span><span class="device-meta">'+(device.is_restricted?'Not available for playback control':'')+(device.is_restricted&&device.supports_volume===false?' · ':'')+(device.supports_volume===false?'Volume control unavailable':'')+'</span></button>'}id('devices-list').innerHTML=html;var volumeDevice=matchedDevice||activeDevice;if(volumeDevice&&volumeDevice.id){volumeDeviceId=volumeDevice.id;if(volumeDevice.supports_volume===false)volumeUnsupportedDeviceId=volumeDevice.id;else if(volumeUnsupportedDeviceId===volumeDevice.id)volumeUnsupportedDeviceId=null;if(typeof volumeDevice.volume_percent==='number'&&volumeDevice.volume_percent>=0&&volumeDevice.volume_percent<=100){volumeValue=volumeDevice.volume_percent;volumeKnown=true}updateVolumeControl()}var buttons=id('devices-list').getElementsByTagName('button');for(var j=0;j<buttons.length;j++)buttons[j].onclick=function(){selectDevice(this.getAttribute('data-device-id'),this)}})}
  function selectDevice(deviceId,button){if(!deviceId||button.disabled)return;var buttons=id('devices-list').getElementsByTagName('button');for(var i=0;i<buttons.length;i++)buttons[i].disabled=true;id('devices-feedback').textContent='Switching playback…';request('POST','/api/spotify/command',{action:'transfer_device',device_id:deviceId},function(status,data){if(status!==200){id('devices-feedback').textContent=(data&&data.error)||'Could not switch playback to that device.';for(var j=0;j<buttons.length;j++)if(buttons[j].className.indexOf('device-unavailable')===-1)buttons[j].disabled=false;return}id('devices-feedback').textContent='Playback switched.';schedulePoll(750);setTimeout(loadDevices,1200)})}
  function openDevicesModal(){id('devices-modal').className='modal';loadDevices()}
  function closeDevicesModal(){id('devices-modal').className='modal hidden'}
  function createPlaylistUi(){var actions=document.getElementsByClassName('actions')[0],button=document.createElement('button');button.id='current-playlist';button.type='button';button.className='icon-action';button.setAttribute('aria-label','Current playlist tracks');button.setAttribute('title','Current playlist tracks');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2.5"/></svg>';actions.appendChild(button);var modal=document.createElement('div');modal.id='playlist-modal';modal.className='modal hidden';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','playlist-question');modal.innerHTML='<div class="modal-box playlist-box"><div class="playlist-header"><p id="playlist-question">Current playlist</p><button id="playlist-close" class="playlist-close" type="button" aria-label="Close playlist">×</button></div><p id="playlist-message" class="message" aria-live="polite"></p><div id="playlist-list" class="playlist-list" aria-live="polite"></div><button id="playlist-more" class="secondary hidden" type="button">Load more tracks</button></div>';document.getElementsByClassName('shell')[0].appendChild(modal)}
  createPlaylistUi();id('current-playlist').onclick=openPlaylistModal;id('playlist-close').onclick=closePlaylistModal;id('playlist-more').onclick=function(){if(playlistNextOffset!==null)loadPlaylistTracks(playlistNextOffset)};
  function openPlaylistModal(){playlistId=null;playlistNextOffset=null;playlistCurrentUri=null;id('playlist-question').textContent='Current playlist';id('playlist-message').textContent='Loading playlist…';id('playlist-list').innerHTML='';id('playlist-more').className='secondary hidden';id('playlist-modal').className='modal';loadPlaylistTracks(0)}
  function closePlaylistModal(){id('playlist-modal').className='modal hidden'}
  function renderPlaylistItems(items){var list=id('playlist-list');for(var i=0;i<items.length;i++){(function(item){var row=document.createElement('button');row.type='button';row.className='playlist-track'+(item.uri&&item.uri===playlistCurrentUri?' is-playing':'');row.disabled=!item.playable;row.setAttribute('data-position',String(item.position));var title=document.createElement('span');title.className='playlist-track-title';title.textContent=item.name;var artist=document.createElement('span');artist.className='playlist-track-artist';artist.textContent=item.artists.join(', ')||'Unknown artist';var marker=document.createElement('span');marker.className='playlist-track-marker';marker.textContent=item.uri&&item.uri===playlistCurrentUri?'NOW PLAYING':'';row.appendChild(title);row.appendChild(artist);row.appendChild(marker);row.onclick=function(){playPlaylistTrack(item.position,item,row)};list.appendChild(row)})(items[i])}}
  function loadPlaylistTracks(offset){var url='/api/spotify/currently-playing?playlist=1&offset='+offset;if(playlistId)url+='&playlist_id='+encodeURIComponent(playlistId);if(offset===0)id('playlist-list').innerHTML='';id('playlist-more').disabled=true;id('playlist-message').textContent=offset?'Loading more tracks…':'Loading playlist…';request('GET',url,null,function(status,data){if(status!==200){id('playlist-message').textContent=playlistError(data,'Could not load the current playlist.');id('playlist-more').className='secondary hidden';return}playlistId=data.playlist_id||null;if(data.device_id)playbackDeviceId=data.device_id;playlistCurrentUri=data.current_track_uri||null;playlistNextOffset=data.next_offset;id('playlist-question').textContent=(data.source==='queue'?'Current queue':'Current playlist')+' · '+data.total+' tracks';id('playlist-message').textContent=data.items.length?'Tap a track to play it. The list will stay open.':'There are no available tracks.';renderPlaylistItems(data.items||[]);if(playlistNextOffset!==null){id('playlist-more').className='secondary';id('playlist-more').disabled=false}else id('playlist-more').className='secondary hidden'})}
  function playPlaylistTrack(position,track,row){id('playlist-message').textContent='Starting track…';var uri=track.uri,body=playlistId?{action:'play_playlist_track',playlist_id:playlistId,position:position}:{action:'play_track',track_uri:uri};if(playbackDeviceId)body.device_id=playbackDeviceId;request('POST','/api/spotify/command',body,function(status,data){if(status!==200){id('playlist-message').textContent=playlistError(data,'Could not play this track.');return}if(data&&data.device_id)playbackDeviceId=data.device_id;playlistCurrentUri=uri;var rows=id('playlist-list').getElementsByTagName('button');for(var i=0;i<rows.length;i++){rows[i].className=rows[i]===row?'playlist-track is-playing':'playlist-track';var marker=rows[i].getElementsByTagName('span')[2];if(marker)marker.textContent=rows[i]===row?'NOW PLAYING':''}var album={name:track.album_name||'',images:track.album_images||[]};var device=playbackDeviceId?{id:playbackDeviceId}:current&&current.device||null;optimisticPlaybackUntil=Date.now()+15000;render({item:{id:track.id||uri.split(':').pop(),uri:uri,name:track.name,artists:track.artists.map(function(name){return{name:name}}),album:album,duration_ms:track.duration_ms||0},is_playing:true,device:device,progress_ms:0});id('playlist-message').textContent=playlistId?'Playing from this playlist.':'Playing this track.';playerMessage('Starting playback…');schedulePoll(750)})}
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
  document.getElementsByClassName('site-title')[0].onclick=returnToProfiles;id('add-profile').onclick=openAddProfile;id('cancel-add-profile').onclick=closeAddProfile;id('login').onclick=login;id('pair').onclick=pair;id('pairing-code').onkeyup=function(e){if(e&&e.keyCode===13)pair()};id('previous').onclick=function(){command('previous')};id('next').onclick=function(){command('next')};id('play').onclick=function(){command(current&&current.is_playing?'pause':'play')};id('refresh').onclick=function(){schedulePoll(0)};id('minimalist').onclick=function(){if(minimalist)exitMinimalist();else enterMinimalist()};id('minimalist-exit').onclick=exitMinimalist;id('timeline-slider').oninput=function(){seeking=true;id('time-elapsed').innerHTML=formatTime(parseInt(this.value,10)||0)};id('timeline-slider').onchange=function(){var position=parseInt(this.value,10)||0;seeking=false;if(current&&current.item)command('seek',position)};id('volume-slider').oninput=function(){changingVolume=true;volumeValue=parseInt(this.value,10)||0;id('volume-level').innerHTML=volumeValue+'%'};id('volume-slider').onchange=function(){changingVolume=false;command('volume',parseInt(this.value,10)||0,volumeDeviceId)};id('volume-down').onclick=function(){changeVolumeBy(-5)};id('volume-up').onclick=function(){changeVolumeBy(5)};id('badge-close').onclick=closeBadgeModal;id('art-tap').onclick=function(){if(minimalist)artworkTap();else toggleLyrics()};id('lyrics-close').onclick=function(e){if(e&&e.stopPropagation)e.stopPropagation();toggleLyrics()};id('disconnect').onclick=openDisconnectModal;id('disconnect-confirm').onclick=confirmDisconnect;id('disconnect-cancel').onclick=closeDisconnectModal;id('remove-profile').onclick=openRemoveProfileModal;id('remove-profile-confirm').onclick=removeProfile;id('remove-profile-cancel').onclick=closeRemoveProfileModal;id('search-artist').onclick=openArtistModal;id('devices').onclick=openDevicesModal;id('devices-refresh').onclick=loadDevices;id('devices-close').onclick=closeDevicesModal;id('search-tab-artist').onclick=function(){switchSearchMode('artist')};id('search-tab-playlist').onclick=function(){switchSearchMode('playlist')};id('artist-search-go').onclick=searchArtist;id('artist-cancel').onclick=closeArtistModal;id('artist-query').onkeyup=function(e){if(e&&e.keyCode===13)searchArtist()};id('playlist-query').onkeyup=function(e){if(e&&e.keyCode===13)searchArtist()};document.addEventListener('visibilitychange',visibilityChanged,false);
  loadProfiles();
}());
