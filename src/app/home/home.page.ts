import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonList, IonItem, IonButton, IonRange, IonButtons, IonSpinner } from '@ionic/angular/standalone';
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
    IonContent,
    IonButton,
    IonRange,
    CommonModule,
    FormsModule,
    IonSpinner,
    IonHeader,
    IonTitle,
    IonButtons,
    IonToolbar,
    IonList,
    IonItem
  ],
})
export class HomePage implements OnInit {
  @ViewChild('visualizerCanvas', { static: false }) visualizerCanvas!: ElementRef<HTMLCanvasElement>;

  songs: Song[] = [];
  currentIndex = -1;
  currentAudio: HTMLAudioElement | any = null;
  audioCtx: AudioContext | null = null;
  sourceNode: MediaElementAudioSourceNode | null = null;
  analyser!: AnalyserNode;
  dataArray!: Uint8Array;
  isPlaying = false;
  duration = 0;
  currentTime = 0;
  showSongList = false;
  isLoading = false;
  ctx!: CanvasRenderingContext2D;

  constructor(private http: HttpClient) { }

  ngOnInit() {
    this.fetchSongs();
  }

  fetchSongs() {
    this.isLoading = true;
    this.http.get<Song[]>('https://pi.cerberus-acrux.ts.net/s2/list/songs')
      .subscribe(data => {
        this.songs = data;
        this.loadLastPlayed();
        this.isLoading = false;
      });
  }

  loadLastPlayed() {
    const lastIndex = localStorage.getItem('lastIndex');
    const lastTime = localStorage.getItem('lastTime');

    if (lastIndex) this.currentIndex = +lastIndex;

    if (this.currentIndex >= 0) {
      this.playSong(this.currentIndex, false);
      if (lastTime && this.currentAudio) {
        this.currentAudio.currentTime = +lastTime;
      }
    }
  }

  saveLastPlayed() {
    localStorage.setItem('lastIndex', this.currentIndex.toString());
  }

  async playSong(index: number, autoPlay = true) {
    this.currentIndex = index;
    this.saveLastPlayed();

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    const song = this.songs[this.currentIndex];
    this.currentAudio = new Audio(song.url);
    this.currentAudio.crossOrigin = "anonymous"; // 🔥 required for CORS!

    this.setMediaSession(song);
    this.isLoading = true;

    this.currentAudio.addEventListener('loadedmetadata', () => {
      this.duration = this.currentAudio!.duration;
    });

    this.currentAudio.addEventListener('canplay', () => {
      this.isLoading = false;
    });

    this.currentAudio.addEventListener('timeupdate', () => {
      this.currentTime = this.currentAudio!.currentTime;
      localStorage.setItem('lastTime', this.currentTime.toString());
    });

    this.currentAudio.onended = () => this.nextSong();

    if (autoPlay) {
      try {
        await this.currentAudio.play();
        this.isPlaying = true;
        this.isLoading = false;
        this.setupVisualizer();
      } catch (err) {
        console.error('Playback failed:', err);
      }
    } else {
      this.isPlaying = false;
      this.isLoading = false;
    }
  }

  async togglePause() {
    if (!this.currentAudio) return;

    if (this.isPlaying) {
      this.currentAudio.pause();
      this.isPlaying = false;
    } else {
      this.isLoading = true;

      try {
        await this.currentAudio.play();
        this.isPlaying = true;
        this.isLoading = false;
        this.setupVisualizer();
      } catch (err) {
        console.error('Playback failed:', err);
      }
    }
  }

  nextSong() {
    if (this.songs.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.songs.length;
    this.playSong(this.currentIndex);
    this.setupVisualizer();
  }

  prevSong() {
    if (this.songs.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.songs.length) % this.songs.length;
    this.playSong(this.currentIndex);
    this.setupVisualizer();

  }

  seekTo(e: any) {
    if (this.currentAudio) this.currentAudio.currentTime = e.detail.value;
  }

  toggleSongList() {
    this.showSongList = !this.showSongList;
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

  setMediaSession(song: Song) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        artwork: [{ src: song.image, sizes: '512x512', type: 'image/jpeg' }]
      });
      navigator.mediaSession.setActionHandler('play', () => this.togglePause());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePause());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.nextSong());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prevSong());
    }
  }

  get currentSong(): Song | null {
    return this.currentIndex >= 0 ? this.songs[this.currentIndex] : null;
  }

 setupVisualizer() {
  if (!this.visualizerCanvas || !this.currentAudio) return;

  if (!this.audioCtx) {
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  this.audioCtx.resume().then(() => {
    // ⚡ Destroy old sourceNode if it exists
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }

    // ⚡ Create a new sourceNode for the current Audio element
    this.sourceNode = this.audioCtx!.createMediaElementSource(this.currentAudio);
    this.analyser = this.audioCtx!.createAnalyser();

    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioCtx!.destination);

    this.analyser.fftSize = 256;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const canvas = this.visualizerCanvas.nativeElement;
    this.ctx = canvas.getContext('2d')!;

    const draw = () => {
      requestAnimationFrame(draw);

      this.analyser.getByteFrequencyData(this.dataArray);

      const width = canvas.width = canvas.clientWidth;
      const height = canvas.height = canvas.clientHeight;
      this.ctx.clearRect(0, 0, width, height);

      const barWidth = (width / this.dataArray.length) * 2.5;
      let x = 0;

      for (let i = 0; i < this.dataArray.length; i++) {
        const barHeight = this.dataArray[i] / 2;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${barHeight / 255})`;
        this.ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };

    draw();
  });
}

}
