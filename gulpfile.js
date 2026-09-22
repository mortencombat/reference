const gulp = require('gulp');
const htmlmin = require('gulp-htmlmin');
const htmlclean = require('gulp-htmlclean');
const version = require('gulp-version-number');
const terser = require('gulp-terser');

// The Docker runtime builds into a staging directory; see docker/lib/site.mjs.
const publicDir = process.env.REFERENCE_PUBLIC_DIR || './public';

// Compress js files
gulp.task('js', function () {
  return gulp
    .src([`${publicDir}/js/main.js`])
    .pipe(
      terser({
        compress: true
      })
    )
    .pipe(gulp.dest(`${publicDir}/js`));
});

// Build html files
gulp.task('html', function () {
  return gulp
    .src(`${publicDir}/**/*.html`)
    .pipe(htmlclean())
    .pipe(
      htmlmin({
        removeComments: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true
      })
    )
    .pipe(
      version({
        append: {
          key: '_v',
          cover: 1,
          to: ['css', 'js', 'png', 'jpg', 'woff2']
        }
      })
    )
    .pipe(gulp.dest(publicDir));
});

gulp.task('default', gulp.parallel('js', 'html'));
