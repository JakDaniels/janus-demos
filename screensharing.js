// We import the settings.js file to know which address we should contact
// to talk to Janus, and optionally which STUN/TURN servers should be
// used as well. Specifically, that file defines the "server" and
// "iceServers" properties we'll pass when creating the Janus session.

/* global iceServers:readonly, Janus:readonly, server:readonly */

var janus = null;
var screentest = null;
var opaqueId = "screensharingtest-"+Janus.randomString(12);

var myusername = null;
var myid = null;

var capture = null;
var role = null;
var room = null;
var source = null;

var localTracks = {}, localVideos = 0,
	remoteTracks = {}, remoteVideos = 0;

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
		// Use a button to start the demo
		$('#start').one('click', function() {
			$(this).attr('disabled', true).unbind('click');
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				bootbox.alert("No WebRTC support... ");
				return;
			}
			// Create session
			janus = new Janus(
				{
					server: server,
					iceServers: iceServers,
					// Should the Janus API require authentication, you can specify either the API secret or user token here too
					//		token: "mytoken",
					//	or
					apisecret: apisecret,
					success: function() {
						// Attach to VideoRoom plugin
						janus.attach(
							{
								plugin: "janus.plugin.videoroom",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
									$('#details').remove();
									screentest = pluginHandle;
									Janus.log("Plugin attached! (" + screentest.getPlugin() + ", id=" + screentest.getId() + ")");
									// Prepare the username registration
									$('#screenmenu').removeClass('hide');
									$('#createnow').removeClass('hide');
									$('#create').click(preShareScreen);
									$('#joinnow').removeClass('hide');
									$('#join').click(joinScreen);
									$('#desc').focus();
									$('#start').removeAttr('disabled').html("Stop")
										.click(function() {
											$(this).attr('disabled', true);
											janus.destroy();
										});
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin...", error);
									bootbox.alert("Error attaching plugin... " + error);
								},
								consentDialog: function(on) {
									Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
									if(on) {
										// Darken screen
										$.blockUI({
											message: '',
											baseZ: 3001,
											css: {
												border: 'none',
												padding: '15px',
												backgroundColor: 'transparent',
												color: '#aaa'
											} });
									} else {
										// Restore screen
										$.unblockUI();
									}
								},
								iceState: function(state) {
									Janus.log("ICE state changed to " + state);
								},
								mediaState: function(medium, on, mid) {
									Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium + " (mid=" + mid + ")");
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
									$("#screencapture").parent().parent().unblock();
									if(on) {
										bootbox.alert("Your screen sharing session just started: pass the <b>" + room + "</b> session identifier to those who want to attend.");
									} else {
										bootbox.alert("Your screen sharing session just stopped.", function() {
											janus.destroy();
											window.location.reload();
										});
									}
								},
								slowLink: function(uplink, lost, mid) {
									Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
										" packets on mid " + mid + " (" + lost + " lost packets)");
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message (publisher) :::", msg);
									let event = msg["videoroom"];
									Janus.debug("Event: " + event);
									if(event) {
										if(event === "joined") {
											myid = msg["id"];
											$('#session').html(room);
											$('#title').html(escapeXmlTags(msg["description"]));
											Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
											if(role === "publisher") {
												// This is our session, publish our stream
												Janus.debug("Negotiating WebRTC stream for our screen (capture " + capture + ")");
												// Safari expects a user gesture to share the screen: see issue #2455
												if(Janus.webRTCAdapter.browserDetails.browser === "safari") {
													bootbox.alert("Safari requires a user gesture before the screen can be shared: close this dialog to do that. See issue #2455 for more details", function() {
														screentest.createOffer(
															{
																// We want to capture the screen and audio, but sendonly
																tracks: [
																	{ type: 'audio', capture: true, recv: false },
																	{ type: 'screen', capture: true, recv: false }
																],
																success: function(jsep) {
																	Janus.debug("Got publisher SDP!", jsep);
																	let publish = { request: "configure", audio: true, video: true };
																	screentest.send({ message: publish, jsep: jsep });
																},
																error: function(error) {
																	Janus.error("WebRTC error:", error);
																	bootbox.alert("WebRTC error... " + error.message);
																}
															});
													});
												} else {
													// Other browsers should be fine, we try to call getDisplayMedia directly
													screentest.createOffer(
														{
															// We want sendonly audio and screensharing
															tracks: [
																{ type: 'audio', capture: true, recv: false },
																{ type: 'screen', capture: true, recv: false }
															],
															success: function(jsep) {
																Janus.debug("Got publisher SDP!", jsep);
																let publish = { request: "configure", audio: true, video: true };
																screentest.send({ message: publish, jsep: jsep });
															},
															error: function(error) {
																Janus.error("WebRTC error:", error);
																bootbox.alert("WebRTC error... " + error.message);
															}
														});
												}
											} else {
												// We're just watching a session, any feed to attach to?
												if(msg["publishers"]) {
													let list = msg["publishers"];
													Janus.debug("Got a list of available publishers/feeds:", list);
													for(let f in list) {
														if(list[f]["dummy"])
															continue;
														let id = list[f]["id"];
														let display = list[f]["display"];
														Janus.debug("  >> [" + id + "] " + display);
														newRemoteFeed(id, display)
													}
												}
											}
										} else if(event === "event") {
											// Any feed to attach to?
											if(role === "listener" && msg["publishers"]) {
												let list = msg["publishers"];
												Janus.debug("Got a list of available publishers/feeds:", list);
												for(let f in list) {
													if(list[f]["dummy"])
														continue;
													let id = list[f]["id"];
													let display = list[f]["display"];
													Janus.debug("  >> [" + id + "] " + display);
													newRemoteFeed(id, display)
												}
											} else if(msg["leaving"]) {
												// One of the publishers has gone away?
												let leaving = msg["leaving"];
												Janus.log("Publisher left: " + leaving);
												if(role === "listener" && msg["leaving"] === source) {
													bootbox.alert("The screen sharing session is over, the publisher left", function() {
														window.location.reload();
													});
												}
											} else if(msg["error"]) {
												bootbox.alert(msg["error"]);
											}
										}
									}
									if(jsep) {
										Janus.debug("Handling SDP as well...", jsep);
										screentest.handleRemoteJsep({ jsep: jsep });
									}
								},
								onlocaltrack: function(track, on) {
									Janus.debug("Local track " + (on ? "added" : "removed") + ":", track);
									// We use the track ID as name of the element, but it may contain invalid characters
									let trackId = track.id.replace(/[{}]/g, "");
									if(!on) {
										// Track removed, get rid of the stream and the rendering
										let stream = localTracks[trackId];
										if(stream) {
											try {
												let tracks = stream.getTracks();
												for(let i in tracks) {
													let mst = tracks[i];
													if(mst)
														mst.stop();
												}
											// eslint-disable-next-line no-unused-vars
											} catch(e) {}
										}
										if(track.kind === "video") {
											$('#screenvideo' + trackId).remove();
											localVideos--;
											if(localVideos === 0) {
												// No video, at least for now: show a placeholder
												if($('#screencapture .no-video-container').length === 0) {
													$('#screencapture').append(
														'<div class="no-video-container">' +
															'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
															'<span class="no-video-text">No webcam available</span>' +
														'</div>');
												}
											}
										}
										delete localTracks[trackId];
										return;
									}
									// If we're here, a new track was added
									let stream = localTracks[trackId];
									if(stream) {
										// We've been here already
										return;
									}
									$('#screenmenu').addClass('hide');
									$('#room').removeClass('hide');
									if(track.kind === "audio") {
										// We ignore local audio tracks, they'd generate echo anyway
										if(localVideos === 0) {
											// No video, at least for now: show a placeholder
											if($('#screencapture .no-video-container').length === 0) {
												$('#screencapture').append(
													'<div class="no-video-container">' +
														'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
														'<span class="no-video-text">No webcam available</span>' +
													'</div>');
											}
										}
									} else {
										// New video track: create a stream out of it
										localVideos++;
										$('#screencapture .no-video-container').remove();
										let stream = new MediaStream([track]);
										localTracks[trackId] = stream;
										Janus.log("Created local stream:", stream);
										$('#screencapture').append('<video class="rounded centered" id="screenvideo' + trackId + '" width=100% autoplay playsinline muted="muted"/>');
										Janus.attachMediaStream($('#screenvideo' + trackId).get(0), stream);
									}
									if(screentest.webrtcStuff.pc.iceConnectionState !== "completed" &&
											screentest.webrtcStuff.pc.iceConnectionState !== "connected") {
										$("#screencapture").parent().parent().block({
											message: '<b>Publishing...</b>',
											css: {
												border: 'none',
												backgroundColor: 'transparent',
												color: 'white'
											}
										});
									}
								},
								// eslint-disable-next-line no-unused-vars
								onremotetrack: function(track, mid, on) {
									// The publisher stream is sendonly, we don't expect anything here
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									$('#screencapture').empty();
									$("#screencapture").parent().unblock();
									$('#room').addClass('hide');
									localTracks = {};
									localVideos = 0;
								}
							});
					},
					error: function(error) {
						Janus.error(error);
						bootbox.alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});
		});
	}});
});

// eslint-disable-next-line no-unused-vars
function checkEnterShare(field, event) {
	let theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if(theCode == 13) {
		preShareScreen();
		return false;
	} else {
		return true;
	}
}

function preShareScreen() {
	if(!Janus.isExtensionEnabled()) {
		bootbox.alert("This browser doesn't support screensharing (getDisplayMedia unavailable)", function() {
			window.location.reload();
		});
		return;
	}
	// Create a new room
	$('#desc').attr('disabled', true);
	$('#create').attr('disabled', true).unbind('click');
	$('#roomid').attr('disabled', true);
	$('#join').attr('disabled', true).unbind('click');
	if($('#desc').val() === "") {
		bootbox.alert("Please insert a description for the room");
		$('#desc').removeAttr('disabled', true);
		$('#create').removeAttr('disabled', true).click(preShareScreen);
		$('#roomid').removeAttr('disabled', true);
		$('#join').removeAttr('disabled', true).click(joinScreen);
		return;
	}
	capture = "screen";
	shareScreen();
}

function shareScreen() {
	// Create a new room
	let desc = $('#desc').val();
	role = "publisher";
	let create = {
		request: "create",
		description: desc,
		bitrate: 500000,
		publishers: 1
	};
	screentest.send({ message: create, success: function(result) {
		if(result["error"]) {
			bootbox.alert("Couldn't create room: " + result["error"]);
			return;
		}
		let event = result["videoroom"];
		Janus.debug("Event: " + event);
		if(event) {
			// Our own screen sharing session has been created, join it
			room = result["room"];
			Janus.log("Screen sharing session created: " + room);
			myusername = Janus.randomString(12);
			let register = {
				request: "join",
				room: room,
				ptype: "publisher",
				display: myusername
			};
			screentest.send({ message: register });
		}
	}});
}

// eslint-disable-next-line no-unused-vars
function checkEnterJoin(field, event) {
	let theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if(theCode == 13) {
		joinScreen();
		return false;
	} else {
		return true;
	}
}

function joinScreen() {
	// Join an existing screen sharing session
	$('#desc').attr('disabled', true);
	$('#create').attr('disabled', true).unbind('click');
	$('#roomid').attr('disabled', true);
	$('#join').attr('disabled', true).unbind('click');
	let roomid = $('#roomid').val();
	if(isNaN(roomid)) {
		bootbox.alert("Session identifiers are numeric only");
		$('#desc').removeAttr('disabled', true);
		$('#create').removeAttr('disabled', true).click(preShareScreen);
		$('#roomid').removeAttr('disabled', true);
		$('#join').removeAttr('disabled', true).click(joinScreen);
		return;
	}
	room = parseInt(roomid);
	role = "listener";
	myusername = Janus.randomString(12);
	let register = {
		request: "join",
		room: room,
		ptype: "publisher",
		display: myusername
	};
	screentest.send({ message: register });
}

function newRemoteFeed(id, display) {
	// A new feed has been published, create a new plugin handle and attach to it as a listener
	source = id;
	let remoteFeed = null;
	janus.attach(
		{
			plugin: "janus.plugin.videoroom",
			opaqueId: opaqueId,
			success: function(pluginHandle) {
				remoteFeed = pluginHandle;
				remoteFeed.remoteTracks = {};
				remoteFeed.remoteVideos = 0;
				Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
				Janus.log("  -- This is a subscriber");
				// We wait for the plugin to send us an offer
				let listen = {
					request: "join",
					room: room,
					ptype: "subscriber",
					feed: id
				};
				remoteFeed.send({ message: listen });
			},
			error: function(error) {
				Janus.error("  -- Error attaching plugin...", error);
				bootbox.alert("Error attaching plugin... " + error);
			},
			iceState: function(state) {
				Janus.log("ICE state (feed #" + remoteFeed.rfindex + ") changed to " + state);
			},
			webrtcState: function(on) {
				Janus.log("Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
			},
			slowLink: function(uplink, lost, mid) {
				Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
					" packets on mid " + mid + " (" + lost + " lost packets)");
			},
			onmessage: function(msg, jsep) {
				Janus.debug(" ::: Got a message (listener) :::", msg);
				let event = msg["videoroom"];
				Janus.debug("Event: " + event);
				if(event) {
					if(event === "attached") {
						// Subscriber created and attached
						Janus.log("Successfully attached to feed " + id + " (" + display + ") in room " + msg["room"]);
						$('#screenmenu').addClass('hide');
						$('#room').removeClass('hide');
					} else {
						// What has just happened?
					}
				}
				if(jsep) {
					Janus.debug("Handling SDP as well...", jsep);
					// Answer and attach
					remoteFeed.createAnswer(
						{
							jsep: jsep,
							// We only specify data channels here, as this way in
							// case they were offered we'll enable them. Since we
							// don't mention audio or video tracks, we autoaccept them
							// as recvonly (since we won't capture anything ourselves)
							tracks: [
								{ type: 'data' }
							],
							success: function(jsep) {
								Janus.debug("Got SDP!", jsep);
								let body = { request: "start", room: room };
								remoteFeed.send({ message: body, jsep: jsep });
							},
							error: function(error) {
								Janus.error("WebRTC error:", error);
								bootbox.alert("WebRTC error... " + error.message);
							}
						});
				}
			},
			// eslint-disable-next-line no-unused-vars
			onlocaltrack: function(track, on) {
				// The subscriber stream is recvonly, we don't expect anything here
			},
			onremotetrack: function(track, mid, on, metadata) {
				Janus.debug(
					"Remote track (mid=" + mid + ") " +
					(on ? "added" : "removed") +
					(metadata? " (" + metadata.reason + ") " : "") + ":", track
				);
				// Screen sharing tracks are sometimes muted/unmuted by browser
				// when data is not flowing fast enough; this can make streams blink.
				// We can ignore these.
				if(track.kind === "video" && metadata && (metadata.reason === "mute" || metadata.reason === "unmute")) {
					Janus.log("Ignoring mute/unmute on screen-sharing track.")
					return
				}
				if(!on) {
					// Track removed, get rid of the stream and the rendering
					$('#screenvideo' + mid).remove();
					if(track.kind === "video") {
						remoteVideos--;
						if(remoteVideos === 0) {
							// No video, at least for now: show a placeholder
							if($('#screencapture .no-video-container').length === 0) {
								$('#screencapture').append(
									'<div class="no-video-container">' +
										'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
										'<span class="no-video-text">No remote video available</span>' +
									'</div>');
							}
						}
					}
					delete remoteTracks[mid];
					return;
				}
				// If we're here, a new track was added
				if(track.kind === "audio") {
					// New audio track: create a stream out of it, and use a hidden <audio> element
					let stream = new MediaStream([track]);
					remoteTracks[mid] = stream;
					Janus.log("Created remote audio stream:", stream);
					$('#screencapture').append('<audio class="hide" id="screenvideo' + mid + '" playsinline/>');
					$('#screenvideo' + mid).get(0).volume = 0;
					Janus.attachMediaStream($('#screenvideo' + mid).get(0), stream);
					$('#screenvideo' + mid).get(0).play();
					$('#screenvideo' + mid).get(0).volume = 1;
					if(remoteVideos === 0) {
						// No video, at least for now: show a placeholder
						if($('#screencapture .no-video-container').length === 0) {
							$('#screencapture').append(
								'<div class="no-video-container">' +
									'<i class="fa-solid fa-video fa-xl no-video-icon"></i>' +
									'<span class="no-video-text">No remote video available</span>' +
								'</div>');
						}
					}
				} else {
					// New video track: create a stream out of it
					remoteVideos++;
					$('#screencapture .no-video-container').remove();
					let stream = new MediaStream([track]);
					remoteFeed.remoteTracks[mid] = stream;
					Janus.log("Created remote video stream:", stream);
					$('#screencapture').append('<video class="rounded centered" id="screenvideo' + mid + '" width=100% playsinline/>');
					$('#screenvideo' + mid).get(0).volume = 0;
					Janus.attachMediaStream($('#screenvideo' + mid).get(0), stream);
					$('#screenvideo' + mid).get(0).play();
					$('#screenvideo' + mid).get(0).volume = 1;
				}
			},
			oncleanup: function() {
				Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
				$('#waitingvideo').remove();
				remoteFeed.remoteTracks = {};
				remoteFeed.remoteVideos = 0;
			}
		});
}

// Helper to escape XML tags
function escapeXmlTags(value) {
	if(value) {
		let escapedValue = value.replace(new RegExp('<', 'g'), '&lt');
		escapedValue = escapedValue.replace(new RegExp('>', 'g'), '&gt');
		return escapedValue;
	}
}
