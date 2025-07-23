import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  IonContent, IonButton, IonRange, IonHeader, IonTitle,
  IonToolbar, IonList, IonItem, IonSpinner, IonButtons
} from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Song {
  id: string;
  title: string;
  artist: string;
  image: string;
  url: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonContent, IonButton, IonRange, CommonModule,
    FormsModule, IonSpinner, IonHeader, IonTitle,
    IonToolbar, IonList, IonItem, IonButtons
  ],
})
export class HomePage implements OnInit {
  @ViewChild('visualizerCanvas', { static: false })
  visualizerCanvas!: ElementRef<HTMLCanvasElement>;

  songs: Song[] = [];
  currentIndex = -1;
  currentAudio: HTMLAudioElement | null = null;
  nextAudio: HTMLAudioElement | null = null;

  audioCtx: AudioContext | any = null;
  sourceNode: MediaElementAudioSourceNode | any = null;
  analyser!: AnalyserNode;
  dataArray!: Uint8Array;
  ctx!: CanvasRenderingContext2D;

  isPlaying = false;
  isLoading = false;
  duration = 0;
  currentTime = 0;
  bufferPercent = 0;
  showSongList = false;

  isMobile = /Mobi|Android/i.test(navigator.userAgent);

  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.fetchSongs();
  }

  fetchSongs() {
    this.isLoading = true;
    this.http.get<Song[]>('https://pi.cerberus-acrux.ts.net/s2/list/songs')
      .subscribe({
        next: (data) => {
          this.songs = data;
          console.log('Songs loaded:', this.songs.length);
          if (!this.songs.length) {
            console.warn('No songs found.');
            localStorage.removeItem('lastIndex');
            localStorage.removeItem('lastTime');
          } else {
            this.loadLastPlayed();
          }
          this.isLoading = false;
        },
        error: (err) => {
          console.error('Failed to fetch songs:', err);
          this.isLoading = false;
        }
      });
  }

  loadLastPlayed() {
    const lastIndex = +localStorage.getItem('lastIndex')!;
    const lastTime = +localStorage.getItem('lastTime')!;

    if (Number.isFinite(lastIndex) && lastIndex >= 0 && lastIndex < this.songs.length) {
      this.currentIndex = lastIndex;
    } else {
      this.currentIndex = 0; // fallback to first
    }
    this.playSong(this.currentIndex, false).then(() => {
      if (this.currentAudio && Number.isFinite(lastTime)) {
        this.currentAudio.currentTime = lastTime;
      }
    });
  }

  saveLastPlayed() {
    if (this.currentIndex >= 0) {
      localStorage.setItem('lastIndex', this.currentIndex.toString());
    }
  }

  async playSong(index: number, autoPlay = true) {
    if (!this.songs.length) {
      console.warn('No songs loaded yet.');
      return;
    }

    if (index < 0 || index >= this.songs.length) {
      console.warn('Invalid index:', index);
      return;
    }

    const song = this.songs[index];
    if (!song) {
      console.error('Song is undefined for index', index);
      return;
    }

    this.currentIndex = index;
    this.saveLastPlayed();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio.load();
      this.currentAudio = null;
    }

    this.currentAudio = new Audio(song.url);
    this.currentAudio.crossOrigin = 'anonymous';
    this.currentAudio.setAttribute('playsinline', 'true');

    this.isLoading = true;
    this.setMediaSession(song);

    this.currentAudio.addEventListener('loadedmetadata', () => {
      this.duration = this.currentAudio!.duration || 0;
    });

    this.currentAudio.addEventListener('canplaythrough', () => {
      this.isLoading = false;
    });

    this.currentAudio.addEventListener('progress', () => {
      const buffered = this.currentAudio!.buffered;
      if (buffered.length) {
        const loaded = buffered.end(buffered.length - 1);
        this.bufferPercent = (loaded / this.duration) * 100;
      }
    });

    this.currentAudio.addEventListener('timeupdate', () => {
      this.currentTime = this.currentAudio!.currentTime;
      localStorage.setItem('lastTime', this.currentTime.toString());
      if (this.duration - this.currentTime <= 30 && !this.nextAudio) {
        this.preloadNext();
      }
    });

    this.currentAudio.onended = () => this.nextSong();

    if (autoPlay) {
      try {
        await this.currentAudio.play();
        this.isPlaying = true;
        this.setupVisualizer();
      } catch (err) {
        console.error('Playback failed:', err);
        this.isPlaying = false;
      }
    } else {
      this.isPlaying = false;
    }
  }

  preloadNext() {
    if (!this.songs.length) return;

    const nextIndex = (this.currentIndex + 1) % this.songs.length;
    const nextSong = this.songs[nextIndex];
    if (!nextSong) return;

    this.nextAudio = new Audio(nextSong.url);
    this.nextAudio.crossOrigin = 'anonymous';
    this.nextAudio.preload = 'auto';
    this.nextAudio.setAttribute('playsinline', 'true');
  }

  async togglePause() {
    if (!this.currentAudio) return;
    if (this.isPlaying) {
      this.currentAudio.pause();
      this.isPlaying = false;
    } else {
      try {
        await this.currentAudio.play();
        this.isPlaying = true;
        this.setupVisualizer();
      } catch (err) {
        console.error('Playback failed:', err);
      }
    }
  }

  async nextSong() {
    if (!this.songs.length) {
      console.warn('No songs for next.');
      return;
    }

    const nextIndex = (this.currentIndex + 1) % this.songs.length;
    await this.playSong(nextIndex);
  }

  prevSong() {
    if (!this.songs.length) {
      console.warn('No songs for prev.');
      return;
    }
    const prevIndex = (this.currentIndex - 1 + this.songs.length) % this.songs.length;
    this.playSong(prevIndex);
  }

  setMediaSession(song: Song) {
    if ('mediaSession' in navigator && song) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        artwork: [{ src: song.image }],
      });
      navigator.mediaSession.setActionHandler('play', () => this.togglePause());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePause());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.nextSong());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prevSong());
    }
  }

  get currentSong(): Song | null {
    return (this.currentIndex >= 0 && this.currentIndex < this.songs.length)
      ? this.songs[this.currentIndex]
      : null;
  }

  setupVisualizer() {
    if (!this.visualizerCanvas) return;
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    this.audioCtx.resume().then(() => {
      if (this.sourceNode) this.sourceNode.disconnect();
      this.sourceNode = this.audioCtx!.createMediaElementSource(this.currentAudio!);
      this.analyser = this.audioCtx.createAnalyser();
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this.analyser.fftSize = 128;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const canvas = this.visualizerCanvas.nativeElement;
      this.ctx = canvas.getContext('2d')!;

      const draw = () => {
        this.analyser.getByteFrequencyData(this.dataArray);
        const width = canvas.width = canvas.clientWidth;
        const height = canvas.height = canvas.clientHeight;
        this.ctx.clearRect(0, 0, width, height);
        const barWidth = (width / this.dataArray.length) * 2.5;
        let x = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
          const barHeight = this.dataArray[i] / 2;
          this.ctx.fillStyle = `rgba(255,255,255,${barHeight / 255})`;
          this.ctx.fillRect(x, height - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
        requestAnimationFrame(draw);
      };
      draw();
    });
  }

  selectFromList(index: number) {
    this.playSong(index);
    this.showSongList = false;
  }

  formatTime(t: number) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  seekTo(e: any) {
    if (this.currentAudio) {
      this.currentAudio.currentTime = e.detail.value;
    }
  }

  toggleSongList() {
    this.showSongList = !this.showSongList;
  }
}
